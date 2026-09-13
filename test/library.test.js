'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library } = require('../src/main/library');
const { readJson, writeJsonAtomic } = require('../src/main/jsonfile');
const { Settings } = require('../src/main/settings');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dogear-test-'));
}

function ls(dir) {
  return fs.readdirSync(dir).sort();
}

test('jsonfile: atomic write, BOM tolerant read, missing and corrupt', () => {
  const dir = tmp();
  const file = path.join(dir, 'a.json');
  assert.strictEqual(readJson(file).missing, true);
  writeJsonAtomic(file, { a: 1 });
  assert.deepStrictEqual(readJson(file), { ok: true, data: { a: 1 } });
  fs.writeFileSync(file, '\uFEFF{"b":2}');
  assert.deepStrictEqual(readJson(file).data, { b: 2 });
  fs.writeFileSync(file, '{nope');
  const bad = readJson(file);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.missing, false);
});

test('settings: defaults, update persists', () => {
  const dir = tmp();
  const s = new Settings(dir, { libraryRoot: 'X' });
  assert.strictEqual(s.get().hotkey, 'Control+Alt+B');
  assert.strictEqual(s.get().libraryRoot, 'X');
  s.update({ layout: 'side' });
  assert.strictEqual(new Settings(dir, { libraryRoot: 'X' }).get().layout, 'side');
});

test('createBook makes folder, book.json and a first chapter; names are unique', () => {
  const root = tmp();
  const lib = new Library(root);
  const book = lib.createBook({ title: 'Atomic: Habits', kind: 'kindle' });
  assert.strictEqual(book.id, 'Atomic Habits');
  assert.strictEqual(book.meta.title, 'Atomic: Habits');
  assert.deepStrictEqual(ls(path.join(root, 'Atomic Habits')), ['01 Chapter 1', 'book.json']);
  assert.deepStrictEqual(book.chapters.map((c) => c.id), ['01 Chapter 1']);

  const again = lib.createBook({ title: 'atomic habits', kind: 'pdf', pdfPath: 'C:\\b.pdf' });
  assert.strictEqual(again.id, 'atomic habits (2)');
  assert.strictEqual(again.meta.pdfPath, 'C:\\b.pdf');

  const list = lib.listBooks();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].pageCount, 0);
  assert.strictEqual(list[0].cover, null);
});

test('listBooks ignores folders without book.json and a missing root', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'random'));
  assert.deepStrictEqual(new Library(root).listBooks(), []);
  assert.deepStrictEqual(new Library(path.join(root, 'nope')).listBooks(), []);
});

test('chapters: add, rename, delete (empty only) with renumbering', () => {
  const lib = new Library(tmp());
  const { id } = lib.createBook({ title: 'B', kind: 'kindle' });
  const c2 = lib.addChapter(id, 'The Middle');
  assert.strictEqual(c2.id, '02 The Middle');
  lib.addChapter(id);
  assert.deepStrictEqual(lib.getBook(id).chapters.map((c) => c.id), ['01 Chapter 1', '02 The Middle', '03 Chapter 3']);

  assert.strictEqual(lib.renameChapter(id, '02 The Middle', 'Core: Ideas'), '02 Core Ideas');

  lib.addPage(id, PNG, '01 Chapter 1');
  assert.throws(() => lib.deleteChapter(id, '01 Chapter 1'), /not empty/);
  lib.deleteChapter(id, '02 Core Ideas');
  assert.deepStrictEqual(lib.getBook(id).chapters.map((c) => c.id), ['01 Chapter 1', '02 Chapter 3']);
});

test('cannot delete the only chapter', () => {
  const lib = new Library(tmp());
  const { id } = lib.createBook({ title: 'B', kind: 'kindle' });
  assert.throws(() => lib.deleteChapter(id, '01 Chapter 1'), /only chapter/);
});

test('pages: add to last chapter by default, update, move, delete with renumbering', () => {
  const root = tmp();
  const lib = new Library(root);
  const { id } = lib.createBook({ title: 'B', kind: 'kindle' });
  const p1 = lib.addPage(id, PNG);
  const p2 = lib.addPage(id, PNG);
  const p3 = lib.addPage(id, PNG);
  assert.deepStrictEqual([p1.id, p2.id, p3.id], ['01 Chapter 1/001', '01 Chapter 1/002', '01 Chapter 1/003']);
  assert.strictEqual(p1.data.ocr.status, 'pending');
  assert.ok(p1.url.startsWith('file:///'));

  lib.addChapter(id, 'Two');
  const p4 = lib.addPage(id, PNG);
  assert.strictEqual(p4.id, '02 Two/001');

  const data = lib.updatePage(id, p2.id, (d) => { d.label = 'Page 5'; d.notes.push({ id: 'n1', text: 'hi' }); });
  assert.strictEqual(data.label, 'Page 5');
  assert.strictEqual(readJson(path.join(root, 'B', '01 Chapter 1', '002.json')).data.notes[0].text, 'hi');

  const uid = p2.data.uid;
  assert.ok(uid);
  const moved = lib.movePage(id, p2.id, '02 Two');
  assert.strictEqual(moved, '02 Two/002');
  assert.strictEqual(lib.findPageByUid(id, uid), '02 Two/002');
  assert.strictEqual(lib.findPageByUid(id, 'nope'), null);
  assert.deepStrictEqual(ls(path.join(root, 'B', '01 Chapter 1')), ['001.json', '001.png', '002.json', '002.png']);
  assert.strictEqual(lib.getPage(id, '02 Two/002').data.label, 'Page 5');
  assert.strictEqual(lib.movePage(id, '02 Two/002', '02 Two'), '02 Two/002');

  lib.deletePage(id, '01 Chapter 1/001');
  assert.deepStrictEqual(ls(path.join(root, 'B', '01 Chapter 1')), ['001.json', '001.png']);

  const book = lib.getBook(id);
  assert.deepStrictEqual(book.chapters.map((c) => c.pages.length), [1, 2]);
  assert.strictEqual(lib.listBooks()[0].pageCount, 3);
  assert.match(lib.listBooks()[0].cover, /\/01%20Chapter%201\/001\.png\?v=\d+$/);
});

test('updateBook and renameBook', () => {
  const root = tmp();
  const lib = new Library(root);
  const { id } = lib.createBook({ title: 'Old', kind: 'kindle' });
  lib.createBook({ title: 'Taken', kind: 'kindle' });
  lib.updateBook(id, { region: { displayId: '1', x: 1, y: 2, width: 3, height: 4 } });
  assert.strictEqual(lib.getBook(id).meta.region.width, 3);

  const newId = lib.renameBook(id, 'Taken');
  assert.strictEqual(newId, 'Taken (2)');
  assert.strictEqual(lib.getBook(newId).meta.title, 'Taken');
  assert.strictEqual(lib.getBook(newId).meta.region.height, 4);
  assert.ok(!fs.existsSync(path.join(root, 'Old')));
  assert.strictEqual(lib.renameBook(newId, 'Taken (2)'), 'Taken (2)');
});

test('corrupt page json is preserved before being rewritten', () => {
  const root = tmp();
  const lib = new Library(root);
  const { id } = lib.createBook({ title: 'B', kind: 'kindle' });
  const p = lib.addPage(id, PNG);
  const file = path.join(root, 'B', '01 Chapter 1', '001.json');
  fs.writeFileSync(file, '{broken');
  assert.strictEqual(lib.getPage(id, p.id).data.corrupt, true);
  lib.updatePage(id, p.id, (d) => { d.label = 'x'; });
  assert.ok(ls(path.join(root, 'B', '01 Chapter 1')).some((f) => f.startsWith('001.json.corrupt-')));
  assert.strictEqual(readJson(file).data.label, 'x');
});

test('page ids cannot escape the book folder', () => {
  const lib = new Library(tmp());
  const { id } = lib.createBook({ title: 'B', kind: 'kindle' });
  assert.throws(() => lib.getPage(id, '../../x/001'), /Bad page id/);
  assert.throws(() => lib.getBook('..'), /Bad book id/);
});
