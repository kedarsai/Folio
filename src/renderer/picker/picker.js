'use strict';
/* Drag a rectangle over the frozen screen. Esc gets you out. */

const frozen = document.getElementById('frozen');
const sel = document.getElementById('sel');
const size = document.getElementById('size');
const body = document.body;

let start = null;
let sent = false;

window.dogear.onPickerImage(({ url }) => { frozen.src = url; });

function rectFrom(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

function draw(r) {
  sel.hidden = false;
  sel.style.left = `${r.x}px`;
  sel.style.top = `${r.y}px`;
  sel.style.width = `${r.width}px`;
  sel.style.height = `${r.height}px`;

  size.hidden = false;
  size.textContent = `${Math.round(r.width)} x ${Math.round(r.height)}`;
  const top = r.y > 34 ? r.y - 30 : r.y + r.height + 10;
  size.style.left = `${Math.max(8, r.x)}px`;
  size.style.top = `${top}px`;
}

function finish(rect) {
  if (sent) return;
  sent = true;
  window.dogear.pickerPicked(rect);
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  body.dataset.picking = 'true';
  draw(rectFrom(start, start));
});

window.addEventListener('mousemove', (e) => {
  if (!start) return;
  draw(rectFrom(start, { x: e.clientX, y: e.clientY }));
});

window.addEventListener('mouseup', (e) => {
  if (!start) return;
  const r = rectFrom(start, { x: e.clientX, y: e.clientY });
  start = null;
  finish(r.width < 40 || r.height < 40 ? null : r);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') finish(null);
});

// Losing focus means something else grabbed the screen; do not trap the user.
window.addEventListener('blur', () => finish(null));
