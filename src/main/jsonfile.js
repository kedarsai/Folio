'use strict';
const fs = require('fs');

const BOM = 0xfeff;

/** Read a JSON file without throwing. `missing` separates "not there yet"
    from "there but unreadable" - the second must never be silently overwritten. */
function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { ok: false, missing: err.code === 'ENOENT', error: err.message };
  }
  // Notepad and PowerShell like to add a BOM, which JSON.parse refuses.
  if (raw.charCodeAt(0) === BOM) raw = raw.slice(1);
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, missing: false, error: err.message };
  }
}

/** Write to a temp file, then rename over the target. */
function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Keep a copy of an unreadable file before anything replaces it. */
function preserveCorrupt(file) {
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
  } catch (_) { /* best effort */ }
}

module.exports = { readJson, writeJsonAtomic, preserveCorrupt };
