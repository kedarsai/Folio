/* OCR word geometry: flattening, hit-testing, highlight ranges, page labels.
   Pure functions, loaded by Node (require) and by the renderer (<script>,
   exposed as window.DogearWords). All coordinates are image pixels. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DogearWords = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Every word in reading order, tagged with its line number. */
  function flattenWords(ocr) {
    const out = [];
    if (!ocr || !Array.isArray(ocr.lines)) return out;
    ocr.lines.forEach((line, li) => {
      for (const word of (line && line.words) || []) {
        out.push({ t: word.t, x: word.x, y: word.y, w: word.w, h: word.h, line: li });
      }
    });
    return out;
  }

  function order(from, to) {
    return from <= to ? [from, to] : [to, from];
  }

  /** The text of words from..to (inclusive, either order). A word hyphenated
      across a line break is stitched back together. */
  function rangeText(words, from, to) {
    const [a, b] = order(from, to);
    let text = '';
    for (let i = a; i <= b && i < words.length; i++) {
      const word = words[i];
      if (i === a) { text = word.t; continue; }
      const prev = words[i - 1];
      if (prev.line !== word.line && /[a-z]-$/i.test(text) && /^[a-z]/.test(word.t)) {
        text = text.slice(0, -1) + word.t;
      } else {
        text += ' ' + word.t;
      }
    }
    return text;
  }

  /** One bounding rect per line covered by the range, for drawing the marker. */
  function rangeRects(words, from, to) {
    const [a, b] = order(from, to);
    const rects = [];
    let cur = null;
    for (let i = a; i <= b && i < words.length; i++) {
      const word = words[i];
      if (!cur || cur.line !== word.line) {
        cur = { line: word.line, x1: word.x, y1: word.y, x2: word.x + word.w, y2: word.y + word.h };
        rects.push(cur);
      } else {
        cur.x1 = Math.min(cur.x1, word.x);
        cur.y1 = Math.min(cur.y1, word.y);
        cur.x2 = Math.max(cur.x2, word.x + word.w);
        cur.y2 = Math.max(cur.y2, word.y + word.h);
      }
    }
    return rects.map((r) => ({ x: r.x1, y: r.y1, w: r.x2 - r.x1, h: r.y2 - r.y1 }));
  }

  /** Index of the word under (x, y), or the nearest one on the nearest line.
      -1 when there are no words at all. */
  function hitWord(words, x, y) {
    if (!words.length) return -1;
    // Vertical extent of each line.
    const lines = new Map();
    words.forEach((word, i) => {
      const l = lines.get(word.line) || { top: Infinity, bottom: -Infinity, idx: [] };
      l.top = Math.min(l.top, word.y);
      l.bottom = Math.max(l.bottom, word.y + word.h);
      l.idx.push(i);
      lines.set(word.line, l);
    });

    let best = null;
    let bestDist = Infinity;
    for (const l of lines.values()) {
      const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0;
      if (d < bestDist) { bestDist = d; best = l; }
    }

    let hit = -1;
    let hitDist = Infinity;
    for (const i of best.idx) {
      const word = words[i];
      const d = x < word.x ? word.x - x : x > word.x + word.w ? x - (word.x + word.w) : 0;
      if (d < hitDist) { hitDist = d; hit = i; }
    }
    return hit;
  }

  function lineText(line) {
    return ((line && line.words) || []).map((word) => word.t).join(' ').trim();
  }

  const EDGE_ZONE = 0.15;   // headers/footers live in the top or bottom 15%
  const MAX_FOOTER_WORDS = 7;

  /** Page number or Kindle location from a header/footer line, if any.
      `number` is set only for real page numbers (usable to open a PDF).
      Only short lines near the top or bottom edge count, bottom first. */
  function detectLabel(ocr) {
    if (!ocr || !Array.isArray(ocr.lines) || !ocr.lines.length) return null;
    const lines = ocr.lines
      .map((line) => {
        const ws = (line && line.words) || [];
        if (!ws.length) return null;
        return {
          text: lineText(line),
          count: ws.length,
          top: Math.min(...ws.map((x) => x.y)),
          bottom: Math.max(...ws.map((x) => x.y + x.h))
        };
      })
      .filter(Boolean);
    if (!lines.length) return null;

    const top = ocr.height ? 0 : Math.min(...lines.map((l) => l.top));
    const bottom = ocr.height || Math.max(...lines.map((l) => l.bottom));
    const zone = (bottom - top) * EDGE_ZONE;
    const byTop = [...lines].sort((a, b) => a.top - b.top);
    const last = byTop[byTop.length - 1];
    const aboveLast = byTop[byTop.length - 2];
    const lineHeight = byTop.reduce((sum, l) => sum + (l.bottom - l.top), 0) / byTop.length;
    // The bottom-most text line counts as a footer when it stands apart from the text above.
    const lastSetApart = !aboveLast || last.top - aboveLast.bottom >= lineHeight * 1.5;

    const nearBottom = byTop.filter((l) => l.bottom >= bottom - zone).reverse();
    const nearTop = byTop.filter((l) => l.top <= top + zone && !nearBottom.includes(l));
    const candidates = [...nearBottom, ...nearTop];
    if (!candidates.includes(last)) candidates.unshift(last);

    for (const line of candidates) {
      if (line.count > MAX_FOOTER_WORDS) continue;
      let m = /\bpage\s+(\d{1,5})\b/i.exec(line.text);
      if (m) return { label: `Page ${Number(m[1])}`, number: Number(m[1]) };
      m = /\bloc(?:ation)?\.?\s+(\d{1,6})\b/i.exec(line.text);
      if (m) return { label: `Location ${Number(m[1])}`, number: null };
      m = /^(\d{1,4})$/.exec(line.text);
      const inZone = nearBottom.includes(line) || nearTop.includes(line);
      if (m && (inZone || (line === last && lastSetApart))) return { label: String(Number(m[1])), number: Number(m[1]) };
    }
    return null;
  }

  return { flattenWords, rangeText, rangeRects, hitWord, detectLabel };
});
