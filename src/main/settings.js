'use strict';
const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic, preserveCorrupt } = require('./jsonfile');

const DEFAULTS = {
  libraryRoot: null,        // filled in by main (Documents\Dogear)
  hotkey: 'Control+Alt+B',
  layout: 'stack',          // 'stack' = image over notes, 'side' = image beside notes
  alwaysOnTop: false,
  windowBounds: null,
  lastBook: null
};

/** App preferences - not book data. One small JSON file in userData. */
class Settings {
  constructor(dir, overrides = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    const read = readJson(this.file);
    if (!read.ok && !read.missing) preserveCorrupt(this.file);
    this.data = { ...DEFAULTS, ...overrides, ...(read.ok ? read.data : {}) };
    if (!this.data.libraryRoot) this.data.libraryRoot = overrides.libraryRoot || null;
  }

  get() {
    return this.data;
  }

  update(patch) {
    Object.assign(this.data, patch);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      writeJsonAtomic(this.file, this.data);
    } catch (err) {
      console.error('[settings] write failed:', err.message);
    }
    return this.data;
  }
}

module.exports = { Settings, DEFAULTS };
