'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow, nativeImage } = require('electron');
const { buildSummaryModel, buildMarkdown, buildHtml } = require('./summary');

const SUMMARY_FILE = 'Summary.md';

/** Keep Summary.md in the book folder current. Relative image links work in place. */
function writeSummaryFile(library, bookId) {
  const book = library.getBook(bookId);
  const md = buildMarkdown(buildSummaryModel(book));
  const file = path.join(book.dir, SUMMARY_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, md, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/** A .md file plus "<name> images\" beside it, so the export is self-contained. */
function exportMarkdown(library, bookId, targetFile) {
  const book = library.getBook(bookId);
  const model = buildSummaryModel(book);
  const imagesDir = `${path.basename(targetFile, path.extname(targetFile))} images`;
  const base = path.dirname(targetFile);
  for (const ch of model.chapters) {
    for (const item of ch.items) {
      const dest = path.join(base, imagesDir, ...item.rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(item.png)) fs.copyFileSync(item.png, dest);
    }
  }
  fs.writeFileSync(targetFile, buildMarkdown(model, { imagePrefix: `${imagesDir}/` }), 'utf8');
  return targetFile;
}

/** Render the summary to HTML in a hidden window and print it to PDF. */
async function exportPdf(library, bookId, targetFile) {
  const model = buildSummaryModel(library.getBook(bookId));
  const html = buildHtml(model, {
    imageSrc: (item) => {
      const img = nativeImage.createFromPath(item.png);
      if (img.isEmpty()) return '';
      const { width } = img.getSize();
      return (width > 360 ? img.resize({ width: 360, quality: 'good' }) : img).toDataURL();
    }
  });

  const tmp = path.join(os.tmpdir(), `folio-summary-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false, javascript: false } });
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    fs.writeFileSync(targetFile, pdf);
    return targetFile;
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

module.exports = { writeSummaryFile, exportMarkdown, exportPdf, SUMMARY_FILE };
