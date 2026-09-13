'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runOcr, OcrQueue } = require('../src/main/ocr');

const isWindows = process.platform === 'win32';

test('runOcr reads words with boxes from a page image', { skip: !isWindows, timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dogear-ocr-'));
  const png = path.join(dir, 'page.png');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'fixtures', 'make-page.ps1'), '-Out', png]);

  const result = await runOcr(png);
  assert.strictEqual(result.width, 900);
  assert.strictEqual(result.height, 400);
  const first = result.lines[0].words[0];
  assert.strictEqual(first.t, 'Habits');
  for (const k of ['x', 'y', 'w', 'h']) assert.strictEqual(typeof first[k], 'number');
  const text = result.lines.map((l) => l.words.map((w) => w.t).join(' '));
  assert.ok(text.includes('Page 16'), text.join(' | '));
});

test('runOcr rejects for a missing file', { skip: !isWindows, timeout: 60000 }, async () => {
  await assert.rejects(runOcr(path.join(os.tmpdir(), 'does-not-exist-dogear.png')));
});

test('OcrQueue runs jobs one at a time, in order, and survives failures', async () => {
  const order = [];
  let running = 0;
  const q = new OcrQueue(async (file) => {
    running++;
    assert.strictEqual(running, 1);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    if (file === 'bad') throw new Error('boom');
    return file.toUpperCase();
  });
  const results = await Promise.allSettled([q.push('a'), q.push('bad'), q.push('c')]);
  for (const r of results) if (r.status === 'fulfilled') order.push(r.value);
  assert.deepStrictEqual(order, ['A', 'C']);
  assert.strictEqual(results[1].reason.message, 'boom');
});
