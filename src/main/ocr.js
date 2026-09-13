'use strict';
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, 'ocr.ps1');
const TIMEOUT_MS = 30000;

/** OCR one PNG with Windows.Media.Ocr. Resolves to {width, height, lines}. */
function runOcr(pngPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, '-ImagePath', pngPath
    ], { windowsHide: true });

    const out = [];
    const err = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('OCR timed out'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString('utf8').trim() || `OCR exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({
          width: parsed.width,
          height: parsed.height,
          lines: (parsed.lines || []).map((l) => ({ words: [].concat(l.words || []) }))
        });
      } catch (e) {
        reject(new Error(`Could not read OCR output: ${e.message}`));
      }
    });
  });
}

/** Serial queue: one PowerShell at a time keeps the machine responsive while
    you fire off captures quickly. */
class OcrQueue {
  constructor(worker = runOcr) {
    this.worker = worker;
    this.tail = Promise.resolve();
  }

  push(file) {
    const job = this.tail.then(() => this.worker(file));
    this.tail = job.catch(() => {});
    return job;
  }
}

module.exports = { runOcr, OcrQueue };
