'use strict';
const path = require('path');
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');

// Settings live in %APPDATA%\Dogear regardless of the package name's casing.
app.setName('Dogear');
app.setPath('userData', process.env.DOGEAR_USERDATA || path.join(app.getPath('appData'), 'Dogear'));
if (process.platform === 'win32') app.setAppUserModelId('com.kedar.dogear');

const { Settings } = require('./settings');
const { Library } = require('./library');
const { OcrQueue } = require('./ocr');
const capture = require('./capture');
const { openPdfAt } = require('./pdf');
const exporter = require('./exporter');
const { buildSummaryModel } = require('./summary');
const { detectLabel } = require('../shared/words');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const DEV = process.argv.includes('--dev');

let win = null;
let settings = null;
let library = null;
let currentBookId = null;
let hotkeyOk = false;
const ocrQueue = new OcrQueue();
const ocrInFlight = new Set();   // page uids with a job queued or running
const summaryTimers = new Map();

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function toast(kind, text) {
  send('toast', { kind, text });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function visibleBounds(b) {
  if (!b) return null;
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80;
  });
  return onScreen ? b : null;
}

function createWindow() {
  const s = settings.get();
  const bounds = visibleBounds(s.windowBounds);
  win = new BrowserWindow({
    width: bounds ? bounds.width : 620,
    height: bounds ? bounds.height : 940,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    minWidth: 420,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#fdf4e3',
    title: 'Dogear',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false }
  });
  if (s.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  let boundsTimer = null;
  const remember = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) {
        settings.update({ windowBounds: win.getBounds() });
      }
    }, 400);
  };
  win.on('move', remember);
  win.on('resize', remember);
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
  win.on('closed', () => { win = null; });
}

function snapRight() {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const width = Math.max(420, Math.round(area.width / 2));
  win.setBounds({ x: area.x + area.width - width, y: area.y, width, height: area.height });
}

// ---------------------------------------------------------------------------
// Hotkey
// ---------------------------------------------------------------------------
function registerHotkey(accelerator) {
  globalShortcut.unregisterAll();
  hotkeyOk = false;
  if (!accelerator) return false;
  try {
    hotkeyOk = globalShortcut.register(accelerator, () => {
      captureCurrent().catch((err) => toast('error', err.message));
    });
  } catch (_) {
    hotkeyOk = false;
  }
  return hotkeyOk;
}

// ---------------------------------------------------------------------------
// Capture + OCR
// ---------------------------------------------------------------------------
function scheduleSummary(bookId) {
  clearTimeout(summaryTimers.get(bookId));
  summaryTimers.set(bookId, setTimeout(() => {
    summaryTimers.delete(bookId);
    try { exporter.writeSummaryFile(library, bookId); } catch (err) { console.error('[summary]', err.message); }
  }, 500));
}

function flushSummaries() {
  for (const [bookId, timer] of summaryTimers) {
    clearTimeout(timer);
    try { exporter.writeSummaryFile(library, bookId); } catch (_) { /* quitting anyway */ }
  }
  summaryTimers.clear();
}

function queueOcr(bookId, page) {
  const uid = page.data.uid;
  if (!uid || ocrInFlight.has(uid)) return;
  ocrInFlight.add(uid);
  const lib = library;

  ocrQueue.push(page.png)
    .then((result) => ({ ok: true, result }), (err) => ({ ok: false, err }))
    .then(({ ok, result, err }) => {
      ocrInFlight.delete(uid);
      if (lib !== library) return;               // library folder changed meanwhile
      let pageId;
      try { pageId = library.findPageByUid(bookId, uid); } catch (_) { return; }
      if (!pageId) return;                       // page deleted or book renamed meanwhile
      library.updatePage(bookId, pageId, (data) => {
        if (ok) {
          data.ocr = { status: 'done', width: result.width, height: result.height, lines: result.lines, error: null };
          const found = detectLabel(result);
          if (found && !data.label) data.label = found.label;
          if (found && found.number !== null && data.pdfPage == null) data.pdfPage = found.number;
        } else {
          data.ocr = { status: 'failed', width: 0, height: 0, lines: [], error: err.message };
        }
      });
      scheduleSummary(bookId);
      send('book:changed', { bookId, pageId, reason: 'ocr' });
    })
    .catch((e) => console.error('[ocr]', e));
}

/** Re-queue pages left pending (app closed mid-OCR, or a lost job). */
function resumePendingOcr(book) {
  for (const ch of book.chapters) {
    for (const page of ch.pages) {
      if (page.data.ocr.status === 'pending' && page.data.uid) queueOcr(book.id, page);
    }
  }
}

async function captureInto(bookId) {
  const meta = library.readMeta(bookId);
  if (!meta) throw new Error('That book no longer exists.');
  if (!meta.region) return { ok: false, reason: 'no-region' };

  const shot = await capture.grabRegion(meta.region);
  let page = library.addPage(bookId, shot.png);
  if (shot.black) {
    library.updatePage(bookId, page.id, (d) => { d.black = true; });
    page = library.getPage(bookId, page.id);
  }
  send('capture:done', { bookId, pageId: page.id, black: shot.black });
  queueOcr(bookId, page);
  return { ok: true, pageId: page.id, black: shot.black };
}

async function captureCurrent() {
  if (!currentBookId) {
    if (win) { win.show(); win.focus(); }
    toast('info', 'Open a book first, then capture.');
    return;
  }
  const res = await captureInto(currentBookId);
  if (!res.ok && res.reason === 'no-region') {
    if (win) { win.show(); win.focus(); }
    toast('info', 'Set the capture area for this book first.');
    send('capture:needRegion', { bookId: currentBookId });
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => fn(...args));
}

function wireIpc() {
  handle('app:info', () => ({
    libraryRoot: settings.get().libraryRoot,
    hotkey: settings.get().hotkey,
    hotkeyOk,
    layout: settings.get().layout,
    split: settings.get().split || 0.55,
    alwaysOnTop: settings.get().alwaysOnTop,
    lastBook: settings.get().lastBook
  }));

  handle('settings:update', (patch) => {
    const allowed = {};
    for (const k of ['layout', 'split', 'lastBook']) if (k in patch) allowed[k] = patch[k];
    settings.update(allowed);
    return true;
  });

  handle('settings:setHotkey', (accelerator) => {
    const ok = registerHotkey(accelerator);
    if (ok) {
      settings.update({ hotkey: accelerator });
    } else {
      registerHotkey(settings.get().hotkey);
    }
    return { ok, hotkey: settings.get().hotkey, hotkeyOk };
  });

  handle('settings:chooseLibrary', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose where Dogear keeps your books',
      defaultPath: settings.get().libraryRoot,
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    settings.update({ libraryRoot: res.filePaths[0], lastBook: null });
    library = new Library(res.filePaths[0]);
    currentBookId = null;
    return res.filePaths[0];
  });

  handle('app:currentBook', (bookId) => {
    currentBookId = bookId || null;
    if (bookId) settings.update({ lastBook: bookId });
    return true;
  });

  handle('library:list', () => library.listBooks());

  handle('book:create', ({ title, kind, pdfPath }) => {
    const book = library.createBook({ title, kind, pdfPath });
    scheduleSummary(book.id);
    return book;
  });

  handle('book:get', (bookId) => {
    const book = library.getBook(bookId);
    resumePendingOcr(book);
    return book;
  });

  handle('summary:get', (bookId) => buildSummaryModel(library.getBook(bookId)));

  handle('book:rename', (bookId, title) => {
    const newId = library.renameBook(bookId, title);
    if (currentBookId === bookId) currentBookId = newId;
    if (settings.get().lastBook === bookId) settings.update({ lastBook: newId });
    scheduleSummary(newId);
    return newId;
  });

  handle('book:delete', async (bookId) => {
    await shell.trashItem(library.bookDir(bookId));
    if (currentBookId === bookId) currentBookId = null;
    if (settings.get().lastBook === bookId) settings.update({ lastBook: null });
    return true;
  });

  handle('book:choosePdf', async (bookId) => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose the PDF for this book',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    if (bookId) library.updateBook(bookId, { kind: 'pdf', pdfPath: res.filePaths[0] });
    if (bookId) scheduleSummary(bookId);
    return res.filePaths[0];
  });

  handle('book:pickRegion', async (bookId) => {
    const region = await capture.pickRegion({ preload: PRELOAD });
    if (win) { win.show(); win.focus(); }
    if (!region) return null;
    library.updateBook(bookId, { region });
    const abs = capture.regionBounds(region);
    const overlapsUs = !!(abs && win && capture.overlaps(abs, win.getBounds()));
    return { region, overlapsUs };
  });

  handle('book:capture', (bookId) => captureInto(bookId));

  handle('chapter:add', (bookId, title) => {
    const ch = library.addChapter(bookId, title);
    return ch;
  });

  handle('chapter:rename', (bookId, chapterId, title) => {
    const id = library.renameChapter(bookId, chapterId, title);
    scheduleSummary(bookId);
    return id;
  });

  handle('chapter:delete', (bookId, chapterId) => {
    library.deleteChapter(bookId, chapterId);
    scheduleSummary(bookId);
    return true;
  });

  handle('page:update', (bookId, pageId, patch) => {
    const data = library.updatePage(bookId, pageId, (d) => {
      if ('label' in patch) d.label = String(patch.label || '').slice(0, 60);
      if ('pdfPage' in patch) {
        const n = Number(patch.pdfPage);
        d.pdfPage = patch.pdfPage === null || patch.pdfPage === '' || !Number.isFinite(n) ? null : Math.round(n);
      }
      if (Array.isArray(patch.highlights)) d.highlights = patch.highlights;
      if (Array.isArray(patch.notes)) d.notes = patch.notes;
    });
    scheduleSummary(bookId);
    return data;
  });

  handle('page:move', (bookId, pageId, chapterId) => {
    const id = library.movePage(bookId, pageId, chapterId);
    scheduleSummary(bookId);
    return id;
  });

  handle('page:delete', (bookId, pageId) => {
    library.deletePage(bookId, pageId);
    scheduleSummary(bookId);
    return true;
  });

  handle('page:retryOcr', (bookId, pageId) => {
    library.updatePage(bookId, pageId, (d) => {
      d.ocr = { status: 'pending', width: 0, height: 0, lines: [], error: null };
    });
    const page = library.getPage(bookId, pageId);
    queueOcr(bookId, page);
    return page;
  });

  handle('pdf:open', (bookId, page) => {
    const meta = library.readMeta(bookId);
    return openPdfAt(meta && meta.pdfPath, page);
  });

  handle('export:markdown', async (bookId) => {
    const meta = library.readMeta(bookId);
    const res = await dialog.showSaveDialog(win, {
      title: 'Export summary as Markdown',
      defaultPath: path.join(app.getPath('documents'), `${bookId} - Summary.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (res.canceled || !res.filePath) return null;
    exporter.exportMarkdown(library, bookId, res.filePath);
    shell.showItemInFolder(res.filePath);
    return { file: res.filePath, title: meta && meta.title };
  });

  handle('export:pdf', async (bookId) => {
    const res = await dialog.showSaveDialog(win, {
      title: 'Export summary as PDF',
      defaultPath: path.join(app.getPath('documents'), `${bookId} - Summary.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return null;
    await exporter.exportPdf(library, bookId, res.filePath);
    shell.openPath(res.filePath);
    return { file: res.filePath };
  });

  handle('shell:openBookFolder', async (bookId) => {
    if (bookId) {
      try { exporter.writeSummaryFile(library, bookId); } catch (_) { /* still open the folder */ }
    }
    const dir = bookId ? library.bookDir(bookId) : settings.get().libraryRoot;
    require('fs').mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });

  handle('win:minimize', () => win && win.minimize());
  handle('win:maximize', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return win.isMaximized();
  });
  handle('win:close', () => win && win.close());
  handle('win:snapRight', () => snapRight());
  handle('win:pin', () => {
    const on = !settings.get().alwaysOnTop;
    settings.update({ alwaysOnTop: on });
    if (win) win.setAlwaysOnTop(on, 'floating');
    return on;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    settings = new Settings(app.getPath('userData'), {
      libraryRoot: process.env.DOGEAR_LIBRARY || path.join(app.getPath('documents'), 'Dogear')
    });
    library = new Library(settings.get().libraryRoot);
    wireIpc();
    createWindow();
    registerHotkey(settings.get().hotkey);

    // Automated smoke runs: DOGEAR_SMOKE points at a module that drives the window.
    if (process.env.DOGEAR_SMOKE) {
      win.webContents.once('did-finish-load', () => {
        require(process.env.DOGEAR_SMOKE)({ app, win, getLibrary: () => library })
          .catch((err) => { console.error('[smoke]', err); process.exitCode = 1; })
          .finally(() => app.quit());
      });
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    flushSummaries();
  });

  app.on('window-all-closed', () => app.quit());
}
