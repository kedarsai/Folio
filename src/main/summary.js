'use strict';
const { pathToFileURL } = require('url');

/**
 * The Summary: every highlight and note in a book, grouped by chapter, each
 * pointing back to the page it came from. Pure functions over a getBook()
 * result, so the in-app view, Summary.md and both exports agree exactly.
 */

function pageLabel(page) {
  return (page.data.label && String(page.data.label).trim()) || `Capture ${page.index}`;
}

function buildSummaryModel(book) {
  const counts = { highlights: 0, notes: 0 };
  const pdfPath = book.meta.kind === 'pdf' ? book.meta.pdfPath : null;
  const chapters = [];
  for (const ch of book.chapters) {
    const items = [];
    for (const page of ch.pages) {
      const highlights = (page.data.highlights || []).filter((h) => h && h.text);
      const notes = (page.data.notes || []).filter((n) => n && String(n.text || '').trim());
      if (!highlights.length && !notes.length) continue;
      counts.highlights += highlights.length;
      counts.notes += notes.length;
      items.push({
        id: page.id,
        label: pageLabel(page),
        rel: `${ch.id}/${String(page.id.split('/')[1])}.png`,
        png: page.png,
        url: page.url,
        pdfPage: pdfPath && Number.isFinite(Number(page.data.pdfPage)) && page.data.pdfPage !== null ? Number(page.data.pdfPage) : null,
        highlights: highlights.map((h) => ({ id: h.id, text: h.text, note: h.note || '' })),
        notes: notes.map((n) => ({ id: n.id, text: n.text }))
      });
    }
    if (items.length) chapters.push({ id: ch.id, index: ch.index, title: ch.title, items });
  }
  return { bookId: book.id, title: book.meta.title || book.id, kind: book.meta.kind, pdfPath, chapters, counts };
}

/** Percent-encode a path for a Markdown link target, including parentheses. */
function encodePath(p) {
  return p.split('/').map((seg) => encodeURIComponent(seg).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
}

function pdfLink(pdfPath, page) {
  return `${pathToFileURL(pdfPath).href.replace(/\(/g, '%28').replace(/\)/g, '%29')}#page=${page}`;
}

function indentContinuation(text, prefix) {
  return String(text).trim().split(/\r?\n/).join(`\n${prefix}`);
}

function buildMarkdown(model, { imagePrefix = '' } = {}) {
  const out = [`# ${model.title}`, ''];
  const c = model.counts;
  out.push(`_${model.kind === 'pdf' ? 'PDF' : 'Kindle'} · ${c.highlights} highlight${c.highlights === 1 ? '' : 's'} · ${c.notes} note${c.notes === 1 ? '' : 's'}_`, '');

  if (!model.chapters.length) {
    out.push('No highlights or notes yet.', '');
    return out.join('\n');
  }

  for (const ch of model.chapters) {
    out.push(`## ${ch.index}. ${ch.title}`, '');
    for (const item of ch.items) {
      out.push(`### ${item.label}`, '');
      for (const h of item.highlights) {
        out.push(`> ${h.text}`, '');
        if (h.note.trim()) out.push(`↳ ${indentContinuation(h.note, '  ')}`, '');
      }
      if (item.notes.length) {
        for (const n of item.notes) out.push(`- ${indentContinuation(n.text, '  ')}`);
        out.push('');
      }
      const links = [`[Source](${encodePath(imagePrefix + item.rel)})`];
      if (item.pdfPage !== null) links.push(`[Open in PDF p. ${item.pdfPage}](${pdfLink(model.pdfPath, item.pdfPage)})`);
      out.push(links.join(' · '), '');
    }
  }
  return out.join('\n');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Printable HTML for PDF export. `imageSrc(item)` supplies each thumbnail. */
function buildHtml(model, { imageSrc }) {
  const c = model.counts;
  const body = model.chapters.map((ch) => `
    <section class="chapter">
      <h2><span>${ch.index}</span> ${esc(ch.title)}</h2>
      ${ch.items.map((item) => `
        <article class="item">
          <img src="${esc(imageSrc(item))}" alt="" />
          <div class="text">
            <div class="label">${esc(item.label)}</div>
            ${item.highlights.map((h) => `
              <blockquote>${esc(h.text)}</blockquote>
              ${h.note.trim() ? `<p class="thought">↳ ${esc(h.note)}</p>` : ''}`).join('')}
            ${item.notes.length ? `<ul>${item.notes.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul>` : ''}
          </div>
        </article>`).join('')}
    </section>`).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${esc(model.title)}</title>
<style>
  @page { margin: 16mm 14mm; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #3a261c; background: #fffaf2; margin: 0; }
  header { border-bottom: 3px solid #3a261c; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-family: "Bahnschrift", "Segoe UI Semibold", sans-serif; font-size: 28px; margin: 0 0 4px; }
  .meta { font-family: "Bahnschrift", sans-serif; text-transform: uppercase; letter-spacing: .12em; font-size: 10px; color: #6b5244; }
  h2 { font-family: "Bahnschrift", sans-serif; font-size: 18px; margin: 22px 0 10px; display: flex; align-items: center; gap: 10px; }
  h2 span { display: inline-block; min-width: 26px; text-align: center; background: #3a261c; color: #fffaf2; border-radius: 999px; padding: 2px 8px; font-size: 13px; }
  .item { display: flex; gap: 14px; border: 2px solid #3a261c; border-radius: 12px; padding: 10px; margin: 0 0 10px; break-inside: avoid; background: #fff; }
  .item img { width: 120px; align-self: flex-start; border: 1.5px solid #a08d7d; border-radius: 6px; }
  .text { flex: 1; min-width: 0; }
  .label { font-family: "Bahnschrift", sans-serif; text-transform: uppercase; letter-spacing: .12em; font-size: 10px; color: #d66a16; margin-bottom: 4px; }
  blockquote { margin: 4px 0; padding: 4px 10px; border-left: 4px solid #e9c46a; background: #fdf1cf; font-size: 13px; line-height: 1.5; }
  .thought { margin: 2px 0 8px 12px; font-size: 12.5px; color: #6b5244; white-space: pre-wrap; }
  ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; }
  li { white-space: pre-wrap; margin: 2px 0; }
  .none { color: #a08d7d; }
</style></head>
<body>
  <header>
    <h1>${esc(model.title)}</h1>
    <div class="meta">${model.kind === 'pdf' ? 'PDF' : 'Kindle'} · ${c.highlights} highlights · ${c.notes} notes</div>
  </header>
  ${body || '<p class="none">No highlights or notes yet.</p>'}
</body></html>`;
}

module.exports = { buildSummaryModel, buildMarkdown, buildHtml, encodePath };
