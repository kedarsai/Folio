'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { readJson, writeJsonAtomic, preserveCorrupt } = require('./jsonfile');
const names = require('../shared/names');

/**
 * The only module that touches book folders.
 *
 *   <root>/<Book Title>/book.json
 *   <root>/<Book Title>/NN Chapter Title/NNN.png + NNN.json
 *
 * Ids are the folder names themselves: a book id is its folder, a chapter id
 * is its folder, and a page id is "<chapter folder>/<NNN>". Everything is
 * re-read from disk on demand, so hand edits in Explorer are respected.
 */

const BOOK_FILE = 'book.json';

function now() {
  return new Date().toISOString();
}

function newPageData() {
  return {
    capturedAt: now(),
    label: '',
    pdfPage: null,
    black: false,
    ocr: { status: 'pending', width: 0, height: 0, lines: [], error: null },
    highlights: [],
    notes: []
  };
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function assertSegment(value, what) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new Error(`Bad ${what} id: ${value}`);
  }
}

class Library {
  constructor(root) {
    this.root = root;
  }

  // ------------------------------------------------------------------ paths
  bookDir(bookId) {
    assertSegment(bookId, 'book');
    return path.join(this.root, bookId);
  }

  chapterDir(bookId, chapterId) {
    assertSegment(chapterId, 'chapter');
    if (!names.parseChapterDir(chapterId)) throw new Error(`Bad chapter id: ${chapterId}`);
    return path.join(this.bookDir(bookId), chapterId);
  }

  splitPageId(pageId) {
    const parts = String(pageId).split('/');
    if (parts.length !== 2 || !/^\d+$/.test(parts[1])) throw new Error(`Bad page id: ${pageId}`);
    assertSegment(parts[0], 'page');
    if (!names.parseChapterDir(parts[0])) throw new Error(`Bad page id: ${pageId}`);
    return { chapterId: parts[0], index: Number(parts[1]) };
  }

  pageFiles(bookId, pageId) {
    const { chapterId, index } = this.splitPageId(pageId);
    const dir = this.chapterDir(bookId, chapterId);
    const base = names.pageBase(index);
    return { dir, chapterId, index, png: path.join(dir, `${base}.png`), json: path.join(dir, `${base}.json`) };
  }

  pagePath(bookId, pageId) {
    return this.pageFiles(bookId, pageId).png;
  }

  // ------------------------------------------------------------------ books
  readMeta(bookId) {
    const file = path.join(this.bookDir(bookId), BOOK_FILE);
    const read = readJson(file);
    if (read.ok) return read.data;
    if (read.missing) return null;
    return { title: bookId, kind: 'kindle', pdfPath: null, region: null, corrupt: true };
  }

  listBooks() {
    const out = [];
    for (const id of subdirs(this.root)) {
      const meta = this.readMeta(id);
      if (!meta) continue;
      const chapters = this.listChapters(id);
      let pageCount = 0;
      let cover = null;
      for (const ch of chapters) {
        const pages = this.listPageIndexes(id, ch.id);
        pageCount += pages.length;
        if (!cover && pages.length) {
          cover = this.fileUrl(path.join(this.chapterDir(id, ch.id), `${names.pageBase(pages[0])}.png`));
        }
      }
      out.push({ id, title: meta.title || id, kind: meta.kind, pageCount, cover, updatedAt: meta.updatedAt || null });
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  createBook({ title, kind = 'kindle', pdfPath = null }) {
    fs.mkdirSync(this.root, { recursive: true });
    const taken = new Set(subdirs(this.root).map((s) => s.toLowerCase()));
    const id = names.uniqueName(names.sanitizeName(title), taken);
    const dir = path.join(this.root, id);
    fs.mkdirSync(dir);
    const stamp = now();
    writeJsonAtomic(path.join(dir, BOOK_FILE), {
      title: String(title || '').trim() || id,
      kind: kind === 'pdf' ? 'pdf' : 'kindle',
      pdfPath: kind === 'pdf' ? pdfPath : null,
      region: null,
      createdAt: stamp,
      updatedAt: stamp
    });
    fs.mkdirSync(path.join(dir, names.chapterDirName(1, 'Chapter 1')));
    return this.getBook(id);
  }

  getBook(bookId) {
    const meta = this.readMeta(bookId);
    if (!meta) throw new Error(`No such book: ${bookId}`);
    const chapters = this.listChapters(bookId).map((ch) => ({
      ...ch,
      pages: this.listPageIndexes(bookId, ch.id).map((index) => this.getPage(bookId, `${ch.id}/${names.pageBase(index)}`))
    }));
    return { id: bookId, dir: this.bookDir(bookId), meta, chapters };
  }

  updateBook(bookId, patch) {
    const file = path.join(this.bookDir(bookId), BOOK_FILE);
    const read = readJson(file);
    if (!read.ok && !read.missing) preserveCorrupt(file);
    const meta = { ...(read.ok ? read.data : {}), ...patch, updatedAt: now() };
    delete meta.corrupt;
    writeJsonAtomic(file, meta);
    return meta;
  }

  /** Touch updatedAt so the shelf sorts recently used books first. */
  touchBook(bookId) {
    return this.updateBook(bookId, {});
  }

  renameBook(bookId, title) {
    const clean = names.sanitizeName(title);
    let newId = bookId;
    if (clean.toLowerCase() !== bookId.toLowerCase() || clean !== bookId) {
      const taken = new Set(subdirs(this.root).filter((s) => s !== bookId).map((s) => s.toLowerCase()));
      newId = names.uniqueName(clean, taken);
      if (newId !== bookId) fs.renameSync(this.bookDir(bookId), path.join(this.root, newId));
    }
    this.updateBook(newId, { title: String(title).trim() || newId });
    return newId;
  }

  // --------------------------------------------------------------- chapters
  listChapters(bookId) {
    return subdirs(this.bookDir(bookId))
      .map((name) => ({ name, parsed: names.parseChapterDir(name) }))
      .filter((c) => c.parsed)
      .sort((a, b) => a.parsed.index - b.parsed.index || a.name.localeCompare(b.name))
      .map((c) => ({ id: c.name, index: c.parsed.index, title: c.parsed.title }));
  }

  addChapter(bookId, title) {
    const chapters = this.listChapters(bookId);
    const index = chapters.length ? chapters[chapters.length - 1].index + 1 : 1;
    const id = names.chapterDirName(index, title && String(title).trim() ? title : `Chapter ${index}`);
    fs.mkdirSync(path.join(this.bookDir(bookId), id));
    this.touchBook(bookId);
    return { id, index, title: names.parseChapterDir(id).title };
  }

  renameChapter(bookId, chapterId, title) {
    const { index } = names.parseChapterDir(chapterId);
    const newId = names.chapterDirName(index, title);
    if (newId !== chapterId) fs.renameSync(this.chapterDir(bookId, chapterId), path.join(this.bookDir(bookId), newId));
    this.touchBook(bookId);
    return newId;
  }

  deleteChapter(bookId, chapterId) {
    const chapters = this.listChapters(bookId);
    if (chapters.length <= 1) throw new Error('Cannot delete the only chapter');
    if (this.listPageIndexes(bookId, chapterId).length) throw new Error('Chapter is not empty');
    fs.rmSync(this.chapterDir(bookId, chapterId), { recursive: true, force: true });
    this.renumberChapters(bookId);
    this.touchBook(bookId);
  }

  /** Close gaps in chapter prefixes. Ascending order never collides. */
  renumberChapters(bookId) {
    this.listChapters(bookId).forEach((ch, i) => {
      const want = names.chapterDirName(i + 1, ch.title);
      if (want !== ch.id) fs.renameSync(this.chapterDir(bookId, ch.id), path.join(this.bookDir(bookId), want));
    });
  }

  // ------------------------------------------------------------------ pages
  listPageIndexes(bookId, chapterId) {
    let files;
    try {
      files = fs.readdirSync(this.chapterDir(bookId, chapterId));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return files.map(names.parsePageFile).filter((n) => n !== null).sort((a, b) => a - b);
  }

  fileUrl(file) {
    let v = 0;
    try { v = Math.round(fs.statSync(file).mtimeMs); } catch (_) { /* missing image */ }
    return `${pathToFileURL(file).href}?v=${v}`;
  }

  getPage(bookId, pageId) {
    const f = this.pageFiles(bookId, pageId);
    const read = readJson(f.json);
    let data;
    if (read.ok) data = { ...newPageData(), ...read.data };
    else if (read.missing) throw new Error(`No such page: ${pageId}`);
    else data = { ...newPageData(), corrupt: true, ocr: { status: 'failed', width: 0, height: 0, lines: [], error: 'Page file is unreadable' } };
    return {
      id: `${f.chapterId}/${names.pageBase(f.index)}`,
      index: f.index,
      chapterId: f.chapterId,
      png: f.png,
      url: this.fileUrl(f.png),
      data
    };
  }

  addPage(bookId, pngBuffer, chapterId) {
    const chapters = this.listChapters(bookId);
    const target = chapterId || (chapters.length ? chapters[chapters.length - 1].id : this.addChapter(bookId).id);
    const existing = this.listPageIndexes(bookId, target);
    const index = existing.length ? existing[existing.length - 1] + 1 : 1;
    const pageId = `${target}/${names.pageBase(index)}`;
    const f = this.pageFiles(bookId, pageId);
    fs.writeFileSync(f.png, pngBuffer);
    writeJsonAtomic(f.json, newPageData());
    this.touchBook(bookId);
    return this.getPage(bookId, pageId);
  }

  /** Apply `mutator(data)` (mutate in place or return a replacement) and save. */
  updatePage(bookId, pageId, mutator) {
    const f = this.pageFiles(bookId, pageId);
    const read = readJson(f.json);
    if (!read.ok && read.missing) throw new Error(`No such page: ${pageId}`);
    if (!read.ok) preserveCorrupt(f.json);
    const data = { ...newPageData(), ...(read.ok ? read.data : {}) };
    delete data.corrupt;
    const result = mutator(data) || data;
    writeJsonAtomic(f.json, result);
    return result;
  }

  movePage(bookId, pageId, toChapterId) {
    const from = this.pageFiles(bookId, pageId);
    if (from.chapterId === toChapterId) return pageId;
    this.chapterDir(bookId, toChapterId);
    const existing = this.listPageIndexes(bookId, toChapterId);
    const index = existing.length ? existing[existing.length - 1] + 1 : 1;
    const newId = `${toChapterId}/${names.pageBase(index)}`;
    const to = this.pageFiles(bookId, newId);
    if (fs.existsSync(from.png)) fs.renameSync(from.png, to.png);
    fs.renameSync(from.json, to.json);
    this.renumberPages(bookId, from.chapterId);
    this.touchBook(bookId);
    return newId;
  }

  deletePage(bookId, pageId) {
    const f = this.pageFiles(bookId, pageId);
    fs.rmSync(f.png, { force: true });
    fs.rmSync(f.json, { force: true });
    this.renumberPages(bookId, f.chapterId);
    this.touchBook(bookId);
  }

  renumberPages(bookId, chapterId) {
    const dir = this.chapterDir(bookId, chapterId);
    this.listPageIndexes(bookId, chapterId).forEach((index, i) => {
      if (index === i + 1) return;
      for (const ext of ['png', 'json']) {
        const src = path.join(dir, `${names.pageBase(index)}.${ext}`);
        if (fs.existsSync(src)) fs.renameSync(src, path.join(dir, `${names.pageBase(i + 1)}.${ext}`));
      }
    });
  }
}

module.exports = { Library, newPageData };
