'use strict';
const test = require('node:test');
const assert = require('node:assert');
const w = require('../src/shared/words');

// Two lines: "Habits are compound" / "interest of self"
const OCR = {
  width: 400, height: 100,
  lines: [
    { words: [
      { t: 'Habits', x: 10, y: 10, w: 60, h: 16 },
      { t: 'are', x: 80, y: 11, w: 30, h: 15 },
      { t: 'compound', x: 120, y: 10, w: 90, h: 16 }
    ] },
    { words: [
      { t: 'interest', x: 10, y: 40, w: 70, h: 16 },
      { t: 'of', x: 90, y: 41, w: 20, h: 15 },
      { t: 'self', x: 120, y: 40, w: 40, h: 16 }
    ] }
  ]
};

const lineOf = (...texts) => ({ words: texts.map((t, i) => ({ t, x: i * 50, y: 90, w: 40, h: 10 })) });

test('flattenWords keeps reading order and line numbers', () => {
  const words = w.flattenWords(OCR);
  assert.strictEqual(words.length, 6);
  assert.deepStrictEqual(words.map((x) => x.line), [0, 0, 0, 1, 1, 1]);
  assert.strictEqual(words[3].t, 'interest');
  assert.deepStrictEqual(w.flattenWords(null), []);
  assert.deepStrictEqual(w.flattenWords({ lines: [] }), []);
});

test('rangeText joins words, normalizes reversed ranges', () => {
  const words = w.flattenWords(OCR);
  assert.strictEqual(w.rangeText(words, 1, 3), 'are compound interest');
  assert.strictEqual(w.rangeText(words, 3, 1), 'are compound interest');
  assert.strictEqual(w.rangeText(words, 5, 5), 'self');
});

test('rangeText rejoins words hyphenated across a line break', () => {
  const words = w.flattenWords({ lines: [lineOf('self-im-'), lineOf('provement', 'is')] });
  assert.strictEqual(w.rangeText(words, 0, 2), 'self-improvement is');
});

test('rangeRects returns one merged rect per line', () => {
  const words = w.flattenWords(OCR);
  assert.deepStrictEqual(w.rangeRects(words, 1, 4), [
    { x: 80, y: 10, w: 130, h: 16 },
    { x: 10, y: 40, w: 100, h: 16 }
  ]);
});

test('hitWord finds the word under or nearest to a point', () => {
  const words = w.flattenWords(OCR);
  assert.strictEqual(w.hitWord(words, 90, 18), 1);    // inside "are"
  assert.strictEqual(w.hitWord(words, 117, 18), 2);   // gap, nearer "compound"
  assert.strictEqual(w.hitWord(words, 112, 18), 1);   // gap, nearer "are"
  assert.strictEqual(w.hitWord(words, 300, 45), 5);   // right of line 2 -> "self"
  assert.strictEqual(w.hitWord(words, 15, 95), 3);    // below everything -> line 2
  assert.strictEqual(w.hitWord([], 15, 95), -1);
});

test('detectLabel reads page and location footers', () => {
  const withFooter = (line) => ({ lines: [...OCR.lines, line] });
  assert.deepStrictEqual(w.detectLabel(withFooter(lineOf('Page', '16', 'of', '320'))), { label: 'Page 16', number: 16 });
  assert.deepStrictEqual(w.detectLabel(withFooter(lineOf('Location', '1234', 'of', '5000'))), { label: 'Location 1234', number: null });
  assert.deepStrictEqual(w.detectLabel(withFooter(lineOf('42'))), { label: '42', number: 42 });
  assert.deepStrictEqual(w.detectLabel({ lines: [lineOf('17'), ...OCR.lines] }), { label: '17', number: 17 });
  assert.strictEqual(w.detectLabel(OCR), null);
  assert.strictEqual(w.detectLabel(null), null);
});

test('detectLabel finds a footer even with stray lines below it, but not mid-page numbers', () => {
  const at = (y, ...texts) => ({ words: texts.map((t, i) => ({ t, x: i * 50, y, w: 40, h: 10 })) });
  const body = (y) => at(y, 'some', 'body', 'text', 'here', 'and', 'more');
  // Footer followed by junk from another window
  assert.deepStrictEqual(
    w.detectLabel({ height: 1000, lines: [body(50), body(400), at(900, 'Page', '8'), at(960, 'INBOX'), at(980, 'x')] }),
    { label: 'Page 8', number: 8 });
  // A bare number in the middle of the page is not a page number
  assert.strictEqual(w.detectLabel({ height: 1000, lines: [at(20, 'Chapter'), at(500, '23'), body(600)] }), null);
  // A bare number near the bottom edge is
  assert.deepStrictEqual(w.detectLabel({ height: 1000, lines: [body(100), at(950, '23'), at(990, 'junk', 'line')] }), { label: '23', number: 23 });
  // The last line of text is a footer even with blank margin below it
  assert.deepStrictEqual(w.detectLabel({ height: 1000, lines: [body(100), body(130), at(220, 'Page', '16')] }), { label: 'Page 16', number: 16 });
  // ...and so is a bare number set apart from the text above it
  assert.deepStrictEqual(w.detectLabel({ height: 1000, lines: [body(100), body(130), at(200, '9')] }), { label: '9', number: 9 });
  assert.strictEqual(w.detectLabel({ height: 1000, lines: [body(300), body(330), at(350, '9')] }), null);
  // Long sentences mentioning a page are not footers
  assert.strictEqual(w.detectLabel({ height: 1000, lines: [body(10), at(950, 'as', 'we', 'saw', 'on', 'page', '12', 'the', 'idea', 'holds')] }), null);
});
