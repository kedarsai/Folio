'use strict';
const test = require('node:test');
const assert = require('node:assert');
const n = require('../src/shared/names');

test('sanitizeName strips illegal chars, trims, caps length', () => {
  assert.strictEqual(n.sanitizeName('  Atomic: Habits? <v2>  '), 'Atomic Habits v2');
  assert.strictEqual(n.sanitizeName('a'.repeat(120)).length, 80);
  assert.strictEqual(n.sanitizeName('...'), 'Untitled');
  assert.strictEqual(n.sanitizeName(''), 'Untitled');
  assert.strictEqual(n.sanitizeName('CON'), 'CON_');
  assert.strictEqual(n.sanitizeName('Book. '), 'Book');
});

test('chapter dir names round-trip', () => {
  assert.strictEqual(n.chapterDirName(3, 'The Plan'), '03 The Plan');
  assert.strictEqual(n.chapterDirName(12, 'A/B'), '12 A B');
  assert.deepStrictEqual(n.parseChapterDir('03 The Plan'), { index: 3, title: 'The Plan' });
  assert.deepStrictEqual(n.parseChapterDir('105 Late'), { index: 105, title: 'Late' });
  assert.strictEqual(n.parseChapterDir('notes'), null);
  assert.strictEqual(n.parseChapterDir('03'), null);
});

test('page files', () => {
  assert.strictEqual(n.pageBase(7), '007');
  assert.strictEqual(n.pageBase(1234), '1234');
  assert.strictEqual(n.parsePageFile('007.json'), 7);
  assert.strictEqual(n.parsePageFile('007.png'), null);
  assert.strictEqual(n.parsePageFile('abc.json'), null);
});

test('uniqueName adds (2), (3) case-insensitively', () => {
  assert.strictEqual(n.uniqueName('Book', new Set()), 'Book');
  assert.strictEqual(n.uniqueName('Book', new Set(['book', 'book (2)'])), 'Book (3)');
});
