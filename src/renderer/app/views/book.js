'use strict';
/* The book: capture pages, step through them, highlight words on the
   screenshot and write notes against them. */

(function () {
  const { h, clear, icon, mascot, debounce, uid } = window.D;
  const W = window.DogearWords;
  const UI = window.UI;
  const api = window.dogear;

  window.Views = window.Views || {};

  const pageName = (page) => (page.data.label && page.data.label.trim()) || `Capture ${page.index}`;
  const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

  function autoGrow(ta) {
    const fit = () => {
      ta.style.height = 'auto';
      const borders = ta.offsetHeight - ta.clientHeight;
      ta.style.height = `${ta.scrollHeight + borders}px`;
    };
    ta.addEventListener('input', fit);
    requestAnimationFrame(fit);
    return ta;
  }

  // ------------------------------------------------------------ shared head
  /** Book header with back, title, Pages/Summary tabs and the Capture button. */
  function renderHead(app, book, active, { onCapture, onRenamed }) {
    const captureBtn = h('button.btn.btn--primary.bk__capture', {
      title: `Capture the page (${String(app.info.hotkey || '').replace('Control', 'Ctrl')})`,
      onclick: () => onCapture(captureBtn)
    }, icon('camera'), h('span', 'Capture'));

    const title = h('button.bk__title', {
      title: 'Rename book',
      onclick: async () => {
        const next = await UI.prompt({ title: 'Rename book', value: book.meta.title });
        if (!next || next === book.meta.title) return;
        const newId = await app.run(() => api.renameBook(book.id, next));
        if (newId) onRenamed(newId);
      }
    }, book.meta.title);

    const tab = (name, label, ic) => h('button', {
      'aria-pressed': String(active === name),
      onclick: () => { if (active !== name) app.go(name, { bookId: book.id }); }
    }, icon(ic), h('span', label));

    return {
      el: h('div.bk__head',
        h('button.iconBtn', { title: 'Back to shelf', onclick: () => app.go('library') }, icon('back')),
        h('div.bk__titleWrap', title,
          h(`span.pill.pill--${book.meta.kind === 'pdf' ? 'pdf' : 'kindle'}`, book.meta.kind === 'pdf' ? 'PDF' : 'Kindle')),
        h('div.seg.bk__tabs', tab('book', 'Pages', 'list'), tab('summary', 'Summary', 'note')),
        captureBtn),
      captureBtn
    };
  }

  /** Capture into a book, handling the "no area yet" case. */
  async function doCapture(app, bookId, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await app.run(() => api.capture(bookId));
      if (res && !res.ok && res.reason === 'no-region') {
        const set = await window.Views.library.regionIntro(app, bookId);
        if (set) await app.run(() => api.capture(bookId));
      }
    } finally {
      if (btn) setTimeout(() => { btn.disabled = false; }, 250);
    }
  }

  // ------------------------------------------------------------------ view
  window.Views.book = {
    renderHead,
    doCapture,

    async mount(root, params, app) {
      let bookId = params.bookId;
      let book = await api.getBook(bookId);
      let pages = [];
      let cur = -1;                       // index into pages, -1 = none
      let chapterView = null;             // chapter id when showing an empty chapter
      let layout = app.info.layout || 'stack';
      let split = app.info.split || 0.55;
      let flashId = params.flash || null;
      const cleanups = [];

      app.setSubtitle(book.meta.title);

      // ------------------------------------------------------------ state
      function flatten() {
        pages = [];
        for (const ch of book.chapters) for (const p of ch.pages) pages.push({ ...p, chapter: ch });
      }
      flatten();

      const page = () => (cur >= 0 ? pages[cur] : null);

      function indexOf(pageId) {
        return pages.findIndex((p) => p.id === pageId);
      }

      // Text edits save shortly after typing stops; structural edits save now.
      let pending = null;
      const saveSoon = debounce(() => flushSave(), 400);
      function queueSave(p, fields) {
        if (pending && pending.pageId !== p.id) flushSave();
        pending = { pageId: p.id, p, fields: new Set([...(pending ? pending.fields : []), ...fields]) };
        saveSoon();
      }
      function flushSave() {
        if (!pending) return Promise.resolve();
        const { pageId, p, fields } = pending;
        pending = null;
        const patch = {};
        for (const f of fields) patch[f] = p.data[f];
        return app.run(() => api.updatePage(bookId, pageId, patch));
      }
      async function saveNow(p, fields) {
        if (pending && pending.pageId === p.id) {
          fields = [...new Set([...pending.fields, ...fields])];
          pending = null;
        } else {
          await flushSave();
        }
        const patch = {};
        for (const f of fields) patch[f] = p.data[f];
        return app.run(() => api.updatePage(bookId, p.id, patch));
      }

      async function reload({ keepPageId, keepLocal = true } = {}) {
        await flushSave();
        const local = keepLocal && page() ? { id: page().id, highlights: page().data.highlights, notes: page().data.notes } : null;
        const fresh = await app.run(() => api.getBook(bookId));
        if (!fresh) return false;
        book = fresh;
        flatten();
        const want = keepPageId || (local && local.id);
        cur = want ? indexOf(want) : cur;
        if (cur >= pages.length) cur = pages.length - 1;
        if (local && cur >= 0 && pages[cur].id === local.id) {
          pages[cur].data.highlights = local.highlights;
          pages[cur].data.notes = local.notes;
        }
        return true;
      }

      // -------------------------------------------------------------- DOM
      const head = renderHead(app, book, 'book', {
        onCapture: (btn) => doCapture(app, bookId, btn),
        onRenamed: (newId) => app.go('book', { bookId: newId, pageId: page() && page().id })
      });

      const chapterSelect = h('select.input.bk__chapter', { title: 'Chapter' });
      const counter = h('span.bk__counter');
      const prevBtn = h('button.iconBtn', { title: 'Previous page (←)', onclick: () => step(-1) }, icon('prev'));
      const nextBtn = h('button.iconBtn', { title: 'Next page (→)', onclick: () => step(1) }, icon('next'));
      const labelChip = h('button.bk__label', { title: 'Edit page number', onclick: () => editLabel() });
      const layoutBtn = h('button.iconBtn', { title: 'Switch layout', onclick: () => toggleLayout() });
      const moreBtn = h('button.iconBtn', { title: 'Page & book options', onclick: () => openMenu() }, icon('dots'));

      const bar = h('div.bk__bar',
        chapterSelect,
        h('button.iconBtn', { title: 'New chapter', onclick: () => addChapter() }, icon('plus')),
        h('span.grow'),
        prevBtn, counter, nextBtn,
        labelChip,
        layoutBtn,
        moreBtn);

      const banner = h('div.bk__banner', { hidden: true });
      const img = h('img.bk__img', { alt: '', draggable: false });
      const marks = h('div.bk__marks');
      const scan = h('div.bk__scan', { hidden: true });
      const stage = h('div.bk__stage', img, marks, scan);
      const imgPane = h('div.bk__imgPane', banner, stage);

      const notesCount = h('span.stamp.bk__notesCount');
      const notesList = h('div.bk__notesList');
      const composer = autoGrow(h('textarea.input.bk__composer', { rows: 1, placeholder: 'Write a note about this page…  (Ctrl+Enter)' }));
      const notesPane = h('div.bk__notesPane',
        h('div.bk__notesHead', h('span.bk__notesTitle', icon('marker'), 'Highlights & notes'), notesCount),
        notesList,
        h('div.bk__composerRow', composer,
          h('button.btn.btn--sm.btn--teal', { title: 'Add note', onclick: () => addNote() }, icon('plus'), 'Note')));

      const splitter = h('div.bk__splitter', { title: 'Drag to resize' }, h('span'));
      const work = h('div.bk__work', imgPane, splitter, notesPane);
      const emptyHost = h('div.bk__emptyHost', { hidden: true });

      root.append(h('div.bk', head.el, bar, work, emptyHost));

      // ------------------------------------------------------- rendering
      function renderAll() {
        renderBar();
        applyLayout();
        const p = page();
        work.hidden = !p;
        emptyHost.hidden = !!p;
        if (!p) { renderEmpty(); return; }
        renderImage();
        renderNotes();
      }

      function renderBar() {
        clear(chapterSelect);
        const p = page();
        const activeChapter = p ? p.chapter.id : chapterView || (book.chapters[book.chapters.length - 1] || {}).id;
        for (const ch of book.chapters) {
          chapterSelect.append(h('option', { value: ch.id, selected: ch.id === activeChapter },
            `${ch.index}. ${ch.title}  ·  ${ch.pages.length}`));
        }
        counter.textContent = pages.length ? `${p ? cur + 1 : '–'} / ${pages.length}` : '0 / 0';
        prevBtn.disabled = !p || cur <= 0;
        nextBtn.disabled = !p || cur >= pages.length - 1;
        labelChip.hidden = !p;
        if (p) labelChip.textContent = pageName(p);
        moreBtn.disabled = false;
      }

      function applyLayout() {
        work.dataset.layout = layout;
        const a = `${Math.round(split * 1000) / 10}%`;
        if (layout === 'side') {
          work.style.gridTemplateColumns = `minmax(0, ${a}) 10px minmax(0, 1fr)`;
          work.style.gridTemplateRows = '';
        } else {
          work.style.gridTemplateRows = `minmax(0, ${a}) 10px minmax(0, 1fr)`;
          work.style.gridTemplateColumns = '';
        }
        clear(layoutBtn).append(icon(layout === 'side' ? 'stack' : 'side'));
        layoutBtn.title = layout === 'side' ? 'Put notes under the page' : 'Put notes beside the page';
      }

      function renderEmpty() {
        clear(emptyHost);
        const hasRegion = !!book.meta.region;
        const keys = String(app.info.hotkey || '').replace('Control', 'Ctrl').split('+');
        const emptyChapter = chapterView && pages.length;
        const lastChapter = book.chapters[book.chapters.length - 1];
        const isLast = lastChapter && chapterView === lastChapter.id;
        emptyHost.append(h('div.empty.card.bk__empty',
          mascot(60, 'wow'),
          h('h2', emptyChapter ? (isLast ? 'Fresh chapter' : 'This chapter is empty') : 'Ready when you are'),
          h('p', emptyChapter
            ? (isLast
              ? 'Your next capture lands here.'
              : `New captures land in the last chapter ("${lastChapter.title}"). Move pages here from the ⋯ menu, or delete this chapter.`)
            : 'Open the book on the left side of your screen and capture each page as you read.'),
          h('div.bk__steps',
            h('div.bk__step', { class: hasRegion ? 'is-done' : '' },
              h('span.bk__stepNum', hasRegion ? icon('check') : '1'),
              h('span.grow', hasRegion ? 'Capture area is set' : 'Set the capture area'),
              h('button.btn.btn--sm', { onclick: () => pickArea() }, icon('frame'), hasRegion ? 'Redraw' : 'Draw')),
            h('div.bk__step',
              h('span.bk__stepNum', '2'),
              h('span.grow', 'Press Capture, or ', keys.map((k, i) => [i ? '+' : '', h('kbd', k)]), ' from Kindle')),
            h('div.bk__step',
              h('span.bk__stepNum', '3'),
              h('span.grow', 'Drag the marker over lines to highlight them')))));
      }

      function renderBanner(p) {
        clear(banner);
        banner.className = 'bk__banner';
        banner.hidden = true;
        scan.hidden = true;
        const ocr = p.data.ocr || {};
        const show = (kind, ...children) => {
          banner.hidden = false;
          banner.classList.add(`bk__banner--${kind}`);
          banner.append(...children);
        };
        if (p.data.corrupt) {
          show('error', h('span.grow', 'This page\'s data file could not be read. Your notes are safe on disk; new edits will start a fresh file.'));
        } else if (p.data.black) {
          show('error', h('span.grow', 'This capture came out black. The reader may be blocking screenshots.'),
            h('button.btn.btn--sm', { onclick: () => deletePage() }, 'Delete'));
        } else if (ocr.status === 'pending') {
          scan.hidden = false;
          show('info', h('span.bk__spinner'), h('span.grow', 'Reading the text on this page…'));
        } else if (ocr.status === 'failed') {
          show('error', h('span.grow', `Couldn't read the text: ${ocr.error || 'unknown error'}`),
            h('button.btn.btn--sm', { onclick: () => retryOcr() }, icon('refresh'), 'Retry'));
        } else if (ocr.status === 'done' && !W.flattenWords(ocr).length) {
          show('muted', h('span.grow', 'No text found on this page, so there is nothing to highlight. You can still write notes.'));
        }
      }

      let words = [];
      let natW = 1;
      let natH = 1;

      function renderImage() {
        const p = page();
        renderBanner(p);
        words = W.flattenWords(p.data.ocr);
        natW = p.data.ocr.width || img.naturalWidth || 1;
        natH = p.data.ocr.height || img.naturalHeight || 1;
        if (img.dataset.src !== p.url) {
          img.dataset.src = p.url;
          img.src = p.url;
          imgPane.scrollTop = 0;
        }
        stage.classList.toggle('is-markable', words.length > 0);
        renderMarks();
      }

      img.addEventListener('load', () => {
        const p = page();
        if (!p || p.data.ocr.width) return;
        natW = img.naturalWidth || 1;
        natH = img.naturalHeight || 1;
        renderMarks();
      });

      const pct = (v, total) => `${(v / total) * 100}%`;

      function rectEl(r, cls, hid) {
        const padX = Math.max(2, r.h * 0.12);
        const padY = Math.max(2, r.h * 0.18);
        return h(`div.mark${cls}`, {
          dataset: hid ? { hid } : undefined,
          style: {
            left: pct(r.x - padX, natW), top: pct(r.y - padY, natH),
            width: pct(r.w + padX * 2, natW), height: pct(r.h + padY * 2, natH)
          }
        });
      }

      function renderMarks(live) {
        clear(marks);
        const p = page();
        if (!p) return;
        for (const hl of p.data.highlights) {
          if (!Number.isInteger(hl.from) || !Number.isInteger(hl.to) || hl.to >= words.length) continue;
          for (const r of W.rangeRects(words, hl.from, hl.to)) {
            marks.append(rectEl(r, flashId === hl.id ? '.is-flash' : '', hl.id));
          }
        }
        if (live) for (const r of W.rangeRects(words, live.from, live.to)) marks.append(rectEl(r, '.is-live'));
      }

      function hot(hid, on) {
        for (const el of marks.querySelectorAll(`[data-hid="${CSS.escape(hid)}"]`)) el.classList.toggle('is-hot', on);
      }

      function renderNotes() {
        const p = page();
        clear(notesList);
        const hls = [...p.data.highlights].sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
        const notes = p.data.notes;
        const total = hls.length + notes.length;
        notesCount.textContent = total ? `${hls.length} highlight${hls.length === 1 ? '' : 's'} · ${notes.length} note${notes.length === 1 ? '' : 's'}` : '';

        if (!total) {
          notesList.append(h('div.bk__notesEmpty',
            h('div.bk__demo', h('span', 'Drag'), h('mark', 'across the words'), h('span', 'on the page')),
            h('p', words.length ? 'Your highlights and thoughts for this page collect here.' : 'Write a note below. Highlighting works once the text has been read.')));
          return;
        }

        for (const hl of hls) {
          const thought = autoGrow(h('textarea.bk__thought', { rows: 1, placeholder: 'Your thought…', value: hl.note || '' }));
          thought.addEventListener('input', () => { hl.note = thought.value; queueSave(p, ['highlights']); });
          const card = h('article.qcard', {
            dataset: { hid: hl.id },
            onmouseenter: () => hot(hl.id, true),
            onmouseleave: () => hot(hl.id, false)
          },
            h('blockquote.qcard__quote', hl.text),
            h('div.qcard__foot', thought,
              h('button.iconBtn.iconBtn--danger', { title: 'Remove highlight', onclick: () => removeHighlight(hl.id) }, icon('trash'))));
          if (flashId === hl.id) card.classList.add('is-flash');
          notesList.append(card);
        }

        for (const note of notes) {
          const ta = autoGrow(h('textarea.ncard__text', { rows: 1, value: note.text }));
          ta.addEventListener('input', () => { note.text = ta.value; queueSave(p, ['notes']); });
          ta.addEventListener('blur', () => { if (!ta.value.trim()) removeNote(note.id); });
          notesList.append(h('article.ncard',
            h('span.ncard__pin', icon('note')),
            ta,
            h('button.iconBtn.iconBtn--danger', { title: 'Delete note', onclick: () => removeNote(note.id) }, icon('trash'))));
        }

        if (flashId) {
          const target = notesList.querySelector(`.qcard[data-hid="${CSS.escape(flashId)}"]`);
          if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
          const mark = marks.querySelector('.is-flash');
          if (mark) requestAnimationFrame(() => mark.scrollIntoView({ block: 'center' }));
          setTimeout(() => { flashId = null; }, 1600);
        }
      }

      // ------------------------------------------------------ navigation
      async function show(i) {
        await flushSave();
        chapterView = null;
        cur = Math.max(-1, Math.min(i, pages.length - 1));
        renderAll();
      }

      function step(d) {
        if (cur < 0) return;
        const i = cur + d;
        if (i < 0 || i >= pages.length) return;
        show(i);
      }

      chapterSelect.addEventListener('change', async () => {
        const id = chapterSelect.value;
        const i = pages.findIndex((p) => p.chapter.id === id);
        await flushSave();
        if (i >= 0) { show(i); return; }
        cur = -1;
        chapterView = id;
        renderAll();
      });

      const onKey = (e) => {
        if (isTyping(document.activeElement) || document.querySelector('.backdrop, .menu')) return;
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); step(1); }
      };
      window.addEventListener('keydown', onKey);
      cleanups.push(() => window.removeEventListener('keydown', onKey));

      // -------------------------------------------------------- the marker
      let drag = null;

      function wordAt(e) {
        const r = img.getBoundingClientRect();
        if (!r.width) return -1;
        const x = ((e.clientX - r.left) / r.width) * natW;
        const y = ((e.clientY - r.top) / r.height) * natH;
        return W.hitWord(words, x, y);
      }

      stage.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !page()) return;
        e.preventDefault();
        if (!words.length) {
          const s = page().data.ocr.status;
          if (s === 'pending') UI.toast('Still reading this page, one moment…');
          return;
        }
        const i = wordAt(e);
        if (i < 0) return;
        drag = { from: i, to: i, x: e.clientX, y: e.clientY, moved: false };
      });

      const onMove = (e) => {
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
        drag.moved = true;
        const i = wordAt(e);
        if (i >= 0 && i !== drag.to) {
          drag.to = i;
        }
        renderMarks({ from: drag.from, to: drag.to });
        autoScroll(e);
      };

      const onUp = async () => {
        if (!drag) return;
        const d = drag;
        drag = null;
        const p = page();
        if (!d.moved) {
          // A click on an existing highlight jumps to its card.
          const hit = p.data.highlights.find((hl) => d.from >= Math.min(hl.from, hl.to) && d.from <= Math.max(hl.from, hl.to));
          if (hit) {
            const card = notesList.querySelector(`.qcard[data-hid="${CSS.escape(hit.id)}"]`);
            if (card) {
              card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              card.classList.remove('is-flash');
              void card.offsetWidth;
              card.classList.add('is-flash');
            }
          }
          return;
        }
        const from = Math.min(d.from, d.to);
        const to = Math.max(d.from, d.to);
        const hl = { id: uid('h'), from, to, text: W.rangeText(words, from, to), note: '', createdAt: new Date().toISOString() };
        p.data.highlights.push(hl);
        renderMarks();
        renderNotes();
        const card = notesList.querySelector(`.qcard[data-hid="${CSS.escape(hl.id)}"]`);
        if (card) {
          card.classList.add('is-new');
          card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        await saveNow(p, ['highlights']);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      cleanups.push(() => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      });

      function autoScroll(e) {
        const r = imgPane.getBoundingClientRect();
        const edge = 36;
        if (e.clientY > r.bottom - edge) imgPane.scrollTop += 14;
        else if (e.clientY < r.top + edge) imgPane.scrollTop -= 14;
      }

      // ----------------------------------------------------- notes edits
      async function removeHighlight(hid) {
        const p = page();
        p.data.highlights = p.data.highlights.filter((x) => x.id !== hid);
        renderMarks();
        renderNotes();
        await saveNow(p, ['highlights']);
      }

      async function addNote() {
        const text = composer.value.trim();
        if (!text) { composer.focus(); return; }
        const p = page();
        p.data.notes.push({ id: uid('n'), text, createdAt: new Date().toISOString() });
        composer.value = '';
        composer.dispatchEvent(new Event('input'));
        renderNotes();
        notesList.scrollTop = notesList.scrollHeight;
        await saveNow(p, ['notes']);
      }

      composer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); }
      });

      async function removeNote(nid) {
        const p = page();
        if (!p || !p.data.notes.some((n) => n.id === nid)) return;
        p.data.notes = p.data.notes.filter((n) => n.id !== nid);
        renderNotes();
        await saveNow(p, ['notes']);
      }

      // ------------------------------------------------------ page tools
      async function editLabel() {
        const p = page();
        if (!p) return;
        const isPdf = book.meta.kind === 'pdf';
        const res = await UI.modal({
          title: 'Page number',
          width: 360,
          build: (close) => {
            const label = h('input.input', { value: p.data.label || '', placeholder: `Capture ${p.index}`, maxLength: 60 });
            const pdfPage = h('input.input', { type: 'number', min: 1, value: p.data.pdfPage ?? '', placeholder: 'e.g. 16' });
            const submit = () => close({ label: label.value.trim(), pdfPage: pdfPage.value === '' ? null : Number(pdfPage.value) });
            for (const el of [label, pdfPage]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
            return h('div.modal__body',
              h('label.field', h('span.stamp', 'Label'), label,
                h('span.hint', 'Shown in your summary, e.g. "Page 16" or "Location 1234". Read from the page footer when possible.')),
              isPdf ? h('label.field', h('span.stamp', 'PDF page number'), pdfPage,
                h('span.hint', 'The page "Open in PDF" jumps to. Count pages in the PDF viewer, not printed numbers, if they differ.')) : null,
              h('div.modal__foot',
                h('button.btn.btn--ghost', { onclick: () => close(null) }, 'Cancel'),
                h('button.btn.btn--primary', { onclick: submit }, 'Save')));
          }
        });
        if (!res) return;
        const patch = { label: res.label };
        if (isPdf) patch.pdfPage = res.pdfPage;
        const data = await app.run(() => api.updatePage(bookId, p.id, patch));
        if (!data) return;
        p.data.label = data.label;
        p.data.pdfPage = data.pdfPage;
        renderBar();
      }

      async function pickArea() {
        const set = await window.Views.library.regionIntro(app, bookId);
        if (set) { await reload(); renderAll(); }
      }

      async function retryOcr() {
        const p = page();
        if (!p) return;
        const fresh = await app.run(() => api.retryOcr(bookId, p.id));
        if (fresh) { p.data.ocr = fresh.data.ocr; renderImage(); }
      }

      async function deletePage() {
        const p = page();
        if (!p) return;
        const extra = p.data.highlights.length + p.data.notes.length;
        const ok = await UI.confirm({
          title: 'Delete this page?',
          body: extra
            ? `${pageName(p)} has ${extra} highlight${extra === 1 ? '' : 's'} or note${extra === 1 ? '' : 's'}. They will be deleted too.`
            : `${pageName(p)} will be removed from the book folder.`,
          ok: 'Delete', danger: true
        });
        if (!ok) return;
        pending = null;
        const keep = cur;
        if (!await app.run(() => api.deletePage(bookId, p.id))) return;
        await reload({ keepLocal: false });
        cur = Math.min(keep, pages.length - 1);
        renderAll();
      }

      async function movePage() {
        const p = page();
        if (!p) return;
        const target = await UI.modal({
          title: 'Move page to chapter',
          width: 340,
          build: (close) => h('div.modal__body.bk__moveList',
            book.chapters.map((ch) => h('button.menu__item', {
              disabled: ch.id === p.chapter.id,
              onclick: () => close(ch.id)
            }, icon('move'), h('span', `${ch.index}. ${ch.title}`)))
          )
        });
        if (!target) return;
        await flushSave();
        const newId = await app.run(() => api.movePage(bookId, p.id, target));
        if (!newId) return;
        await reload({ keepPageId: newId, keepLocal: false });
        renderAll();
        UI.toast('Page moved', 'success');
      }

      async function addChapter() {
        const title = await UI.prompt({ title: 'New chapter', label: 'Chapter name', value: `Chapter ${book.chapters.length + 1}`, ok: 'Add' });
        if (!title) return;
        const ch = await app.run(() => api.addChapter(bookId, title));
        if (!ch) return;
        await reload();
        cur = -1;
        chapterView = ch.id;
        renderAll();
        UI.toast(`"${ch.title}" added. New captures go here.`, 'success');
      }

      function currentChapter() {
        const p = page();
        return p ? p.chapter : book.chapters.find((c) => c.id === (chapterView || chapterSelect.value));
      }

      async function renameChapter() {
        const ch = currentChapter();
        if (!ch) return;
        const title = await UI.prompt({ title: 'Rename chapter', value: ch.title });
        if (!title || title === ch.title) return;
        const pageIdx = page() ? page().id.split('/')[1] : null;
        const newId = await app.run(() => api.renameChapter(bookId, ch.id, title));
        if (!newId) return;
        await reload({ keepPageId: pageIdx ? `${newId}/${pageIdx}` : null, keepLocal: false });
        if (!pageIdx) chapterView = newId;
        renderAll();
      }

      async function deleteChapter() {
        const ch = currentChapter();
        if (!ch) return;
        const ok = await UI.confirm({ title: 'Delete chapter?', body: `"${ch.title}" is empty and will be removed.`, ok: 'Delete', danger: true });
        if (!ok) return;
        if (await app.run(() => api.deleteChapter(bookId, ch.id)) === undefined) return;
        await reload({ keepLocal: false });
        chapterView = null;
        cur = pages.length ? Math.max(0, Math.min(cur, pages.length - 1)) : -1;
        renderAll();
      }

      async function openPdf() {
        const p = page();
        if (!p) return;
        if (!p.data.pdfPage) { UI.toast('Set the PDF page number first.'); editLabel(); return; }
        await app.run(() => api.openPdf(bookId, p.data.pdfPage));
      }

      function openMenu() {
        const p = page();
        const ch = currentChapter();
        const isPdf = book.meta.kind === 'pdf';
        UI.menu(moreBtn, [
          { label: book.meta.region ? 'Redraw capture area' : 'Set capture area', icon: 'frame', onClick: pickArea },
          'sep',
          { label: 'Edit page number', icon: 'edit', disabled: !p, onClick: editLabel },
          isPdf ? { label: 'Open this page in PDF', icon: 'pdf', disabled: !p, onClick: openPdf } : null,
          { label: 'Move page to chapter…', icon: 'move', disabled: !p || book.chapters.length < 2, onClick: movePage },
          { label: 'Read text again', icon: 'refresh', disabled: !p, onClick: retryOcr },
          { label: 'Delete page', icon: 'trash', danger: true, disabled: !p, onClick: deletePage },
          'sep',
          { label: 'Rename chapter', icon: 'edit', disabled: !ch, onClick: renameChapter },
          { label: 'Delete chapter', icon: 'trash', danger: true, disabled: !ch || ch.pages.length > 0 || book.chapters.length < 2, onClick: deleteChapter },
          'sep',
          isPdf ? { label: 'Choose PDF file…', icon: 'pdf', onClick: async () => {
            const file = await app.run(() => api.choosePdf(bookId));
            if (file) { await reload(); UI.toast('PDF linked', 'success'); }
          } } : null,
          { label: 'Open book folder', icon: 'folder', onClick: () => api.openFolder(bookId) }
        ].filter(Boolean));
      }

      // ---------------------------------------------------------- layout
      function toggleLayout() {
        layout = layout === 'side' ? 'stack' : 'side';
        applyLayout();
        api.updateSettings({ layout });
        app.info.layout = layout;
      }

      const saveSplit = debounce(() => { api.updateSettings({ split }); app.info.split = split; }, 300);
      splitter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const r = work.getBoundingClientRect();
        splitter.classList.add('is-dragging');
        const move = (ev) => {
          const ratio = layout === 'side' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
          split = Math.max(0.2, Math.min(0.8, ratio));
          applyLayout();
        };
        const up = () => {
          splitter.classList.remove('is-dragging');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          saveSplit();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      splitter.addEventListener('dblclick', () => { split = 0.55; applyLayout(); saveSplit(); });

      // ---------------------------------------------------------- events
      cleanups.push(api.on('capture:done', async ({ bookId: id, pageId, black }) => {
        if (id !== bookId) return;
        UI.snapSound();
        head.captureBtn.classList.remove('is-snap');
        void head.captureBtn.offsetWidth;
        head.captureBtn.classList.add('is-snap');
        await reload({ keepPageId: pageId });
        cur = indexOf(pageId);
        chapterView = null;
        renderAll();
        stage.classList.remove('is-arrived');
        void stage.offsetWidth;
        stage.classList.add('is-arrived');
        if (black) UI.toast('That capture came out black. The reader may be blocking screenshots.', 'error');
      }));

      cleanups.push(api.on('book:changed', async ({ bookId: id, pageId }) => {
        if (id !== bookId) return;
        const viewing = page() && page().id;
        await reload();
        if (pageId === viewing && page()) {
          renderBar();
          renderImage();
          if (!notesPane.contains(document.activeElement)) renderNotes();
        } else {
          renderBar();
        }
      }));

      cleanups.push(api.on('capture:needRegion', ({ bookId: id }) => {
        if (id === bookId) pickArea();
      }));

      // ----------------------------------------------------------- start
      cur = params.pageId ? indexOf(params.pageId) : pages.length - 1;
      renderAll();

      return () => {
        flushSave();
        for (const fn of cleanups) fn();
      };
    }
  };
})();
