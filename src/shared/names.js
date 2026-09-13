'use strict';
/* Folder and file naming. Books are folders named after their title,
   chapters are "NN Title" folders, pages are "NNN.png" + "NNN.json".
   Ordering lives entirely in these numeric prefixes. */

const MAX_NAME = 80;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A title Windows will accept as a folder name. */
function sanitizeName(input) {
  let s = String(input == null ? '' : input)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    // Windows silently drops trailing dots and spaces, which breaks lookups.
    .replace(/[. ]+$/, '');
  if (!s || /^\.+$/.test(s)) return 'Untitled';
  if (RESERVED.test(s)) s += '_';
  return s;
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function chapterDirName(index, title) {
  return `${pad(index, 2)} ${sanitizeName(title)}`;
}

function parseChapterDir(name) {
  const m = /^(\d+) (.+)$/.exec(name);
  return m ? { index: Number(m[1]), title: m[2] } : null;
}

function pageBase(index) {
  return pad(index, 3);
}

/** Index of a page's data file, or null for anything else in the folder. */
function parsePageFile(name) {
  const m = /^(\d+)\.json$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** `base`, or `base (2)`, `base (3)`… whichever is not taken (case-insensitive). */
function uniqueName(base, taken) {
  const has = (s) => taken.has(s.toLowerCase());
  if (!has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!has(candidate)) return candidate;
  }
}

module.exports = { sanitizeName, pad, chapterDirName, parseChapterDir, pageBase, parsePageFile, uniqueName };
