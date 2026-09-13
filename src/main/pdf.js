'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { shell } = require('electron');

// Windows has no standard "open this PDF at page N" verb, but Edge's viewer
// honours #page=N and Edge ships with every Windows 11 install.
function edgePath() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** Open a PDF at a page. Falls back to the default PDF app (first page). */
async function openPdfAt(pdfPath, page) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    throw new Error('The PDF file for this book was not found. Pick it again from the book menu.');
  }
  const edge = edgePath();
  const n = Number(page);
  if (edge && Number.isFinite(n) && n > 0) {
    const url = `${pathToFileURL(pdfPath).href}#page=${Math.round(n)}`;
    const child = spawn(edge, [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return { via: 'edge' };
  }
  const err = await shell.openPath(pdfPath);
  if (err) throw new Error(err);
  return { via: 'default' };
}

module.exports = { openPdfAt };
