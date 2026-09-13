'use strict';
const path = require('path');
const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');

/**
 * Screen capture for a book's page area.
 *
 * A region is stored in DIP relative to its display's bounds, plus the display
 * id, so it survives the window moving and works on any monitor:
 *   { displayId, x, y, width, height }
 */

const PICKER_HTML = path.join(__dirname, '..', 'renderer', 'picker', 'index.html');

async function grabDisplay(display) {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  });
  const match = sources.find((s) => String(s.display_id) === String(display.id));
  const image = (match || (sources.length === 1 ? sources[0] : null) || {}).thumbnail;
  if (!image || image.isEmpty()) throw new Error('Could not capture the screen');
  return image;
}

function findDisplay(displayId) {
  return screen.getAllDisplays().find((d) => String(d.id) === String(displayId)) || null;
}

/** Absolute (virtual desktop) DIP rect for a stored region, or null if its display is gone. */
function regionBounds(region) {
  const display = region && findDisplay(region.displayId);
  if (!display) return null;
  return {
    x: display.bounds.x + region.x,
    y: display.bounds.y + region.y,
    width: region.width,
    height: region.height
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Freeze the display under the cursor and let the user drag a box on it.
 * Resolves to a region, or null if cancelled.
 */
async function pickRegion({ preload }) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const image = await grabDisplay(display);

  return new Promise((resolve) => {
    let win = null;
    let settled = false;
    const finish = (rect) => {
      if (settled) return;
      settled = true;
      try { ipcMain.removeHandler('picker:picked'); } catch (_) { /* fine */ }
      if (win && !win.isDestroyed()) win.destroy();
      resolve(rect && rect.width >= 40 && rect.height >= 40
        ? {
            displayId: String(display.id),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        : null);
    };

    try { ipcMain.removeHandler('picker:picked'); } catch (_) { /* fine */ }
    ipcMain.handle('picker:picked', (_e, rect) => { finish(rect); return true; });

    win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#000000',
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.on('closed', () => finish(null));
    win.loadFile(PICKER_HTML);
    win.webContents.once('did-finish-load', () => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('picker:image', { url: image.toDataURL() });
      // Match the display exactly even if Windows nudged the window on creation.
      win.setBounds(display.bounds);
      win.show();
      win.focus();
    });
  });
}

/** True when nearly every sampled pixel is black - the tell of a DRM-blocked window. */
function isMostlyBlack(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  let samples = 0;
  let dark = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      samples++;
      if (bitmap[i] < 14 && bitmap[i + 1] < 14 && bitmap[i + 2] < 14) dark++;
    }
  }
  return samples > 0 && dark / samples > 0.97;
}

/** Capture a stored region at native pixel density. */
async function grabRegion(region) {
  const display = region && findDisplay(region.displayId);
  if (!display) {
    const err = new Error('The screen this capture area was drawn on is not connected. Set the capture area again.');
    err.code = 'DISPLAY_MISSING';
    throw err;
  }
  const image = await grabDisplay(display);
  const size = image.getSize();
  const sx = size.width / display.bounds.width;
  const sy = size.height / display.bounds.height;
  const x = Math.max(0, Math.round(region.x * sx));
  const y = Math.max(0, Math.round(region.y * sy));
  const crop = {
    x,
    y,
    width: Math.max(1, Math.min(size.width - x, Math.round(region.width * sx))),
    height: Math.max(1, Math.min(size.height - y, Math.round(region.height * sy)))
  };
  const cropped = image.crop(crop);
  return { png: cropped.toPNG(), black: isMostlyBlack(cropped), width: crop.width, height: crop.height };
}

module.exports = { pickRegion, grabRegion, regionBounds, overlaps };
