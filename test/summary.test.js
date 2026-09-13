'use strict';
const test = require('node:test');
const assert = require('node:assert');
const s = require('../src/main/summary');

function page(chapterId, index, data) {
  const base = String(index).padStart(3, '0');
  return {
    id: `${chapterId}/${base}`, index, chapterId,
    png: `C:\\lib\\Book\\${chapterId}\\${base}.png`, url: `file:///x/${base}.png`,
    data: { label: '', pdfPage: null, highlights: [], notes: [], ...data }
  };
}

function fixture(kind = 'kindle') {
  return {
    id: 'Book',
    meta: { title: 'Atomic Habits', kind, pdfPath: kind === 'pdf' ? 'C:\\books\\atomic habits.pdf' : null },
    chapters: [
      { id: '01 Introduction', index: 1, title: 'Introduction', pages: [
        page('01 Introduction', 1, {
          label: 'Page 16', pdfPage: 16,
          highlights: [{ id: 'h1', from: 0, to: 5, text: 'Habits are the compound interest', note: 'Small wins add up' }],
          notes: [{ id: 'n1', text: 'Re-read this' }]
        }),
        page('01 Introduction', 2, {})
      ] },
      { id: '02 Empty', index: 2, title: 'Empty', pages: [page('02 Empty', 1, {})] },
      { id: '03 Systems', index: 3, title: 'Systems', pages: [
        page('03 Systems', 1, { highlights: [{ id: 'h2', text: 'You fall to the level of your <systems>', note: '' }] })
      ] }
    ]
  };
}

test('model keeps only pages with highlights or notes', () => {
  const model = s.buildSummaryModel(fixture());
  assert.deepStrictEqual(model.chapters.map((c) => c.id), ['01 Introduction', '03 Systems']);
  assert.strictEqual(model.chapters[0].items.length, 1);
  assert.strictEqual(model.chapters[1].items[0].label, 'Capture 1');
  assert.strictEqual(model.chapters[0].items[0].rel, '01 Introduction/001.png');
  assert.deepStrictEqual(model.counts, { highlights: 2, notes: 1 });
});

test('markdown for a kindle book', () => {
  const md = s.buildMarkdown(s.buildSummaryModel(fixture()));
  assert.match(md, /^# Atomic Habits\n/);
  assert.match(md, /\n## 1\. Introduction\n/);
  assert.match(md, /\n### Page 16\n/);
  assert.match(md, /\n> Habits are the compound interest\n/);
  assert.match(md, /\n↳ Small wins add up\n/);
  assert.match(md, /\n- Re-read this\n/);
  assert.match(md, /\[Source\]\(01%20Introduction\/001\.png\)/);
  assert.doesNotMatch(md, /Open in PDF/);
  assert.doesNotMatch(md, /Empty/);
  assert.match(md, /\n## 3\. Systems\n/);
});

test('markdown for a pdf book links to the pdf page; image prefix is applied', () => {
  const md = s.buildMarkdown(s.buildSummaryModel(fixture('pdf')), { imagePrefix: 'Atomic images/' });
  assert.match(md, /\[Open in PDF p\. 16\]\(file:\/\/\/C:\/books\/atomic%20habits\.pdf#page=16\)/);
  assert.match(md, /\[Source\]\(Atomic%20images\/01%20Introduction\/001\.png\)/);
  // no pdfPage -> no pdf link for that item
  assert.strictEqual((md.match(/Open in PDF/g) || []).length, 1);
});

test('markdown for a book with nothing yet', () => {
  const book = fixture();
  book.chapters.forEach((c) => c.pages.forEach((p) => { p.data.highlights = []; p.data.notes = []; }));
  assert.match(s.buildMarkdown(s.buildSummaryModel(book)), /No highlights or notes yet/);
});

test('html escapes text and embeds image sources given by the caller', () => {
  const html = s.buildHtml(s.buildSummaryModel(fixture()), { imageSrc: (item) => `data:${item.id}` });
  assert.match(html, /<title>Atomic Habits<\/title>/);
  assert.match(html, /level of your &lt;systems&gt;/);
  assert.match(html, /src="data:01 Introduction\/001"/);
});
