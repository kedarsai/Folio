'use strict';
/* Tiny DOM helpers and the icon set. Everything hangs off window.D. */

(function () {
  /** h('div.card#id', {onclick, dataset, style, ...attrs}, ...children) */
  function h(spec, props, ...children) {
    if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
      if (props != null) children.unshift(props);
      props = {};
    }
    const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) {
      for (const part of m[2].match(/[.#][\w-]+/g)) {
        if (part[0] === '.') el.classList.add(part.slice(1));
        else el.id = part.slice(1);
      }
    }
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'class') el.className += ` ${value}`;
      else if (key === 'html') el.innerHTML = value;
      else if (key in el && key !== 'list' && key !== 'type') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  // Hand-drawn 24x24 line icons, 2px round strokes in currentColor.
  const PATHS = {
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>',
    dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    frame: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>',
    snap: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><path d="M15 9h3M15 12h3"/>',
    min: '<path d="M6 12h12"/>',
    max: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    stack: '<rect x="4" y="3" width="16" height="8" rx="1.5"/><rect x="4" y="13" width="16" height="8" rx="1.5"/>',
    side: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    source: '<path d="M10 14l-4 4a3 3 0 01-4-4l4-4M14 10l4-4a3 3 0 014 4l-4 4M9 15l6-6"/>',
    marker: '<path d="M15 4l5 5-9 9H6v-5z"/><path d="M4 21h8"/>',
    note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>',
    book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5M8 7h7"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6"/>',
    move: '<path d="M4 12h14M13 7l5 5-5 5"/>',
    check: '<path d="M5 12l5 5 9-10"/>'
  };

  function icon(name, cls = 'ico') {
    const span = document.createElement('span');
    span.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
    return span.firstChild;
  }

  /** The mascot: a page with a folded corner and a face. */
  function mascot(size = 30, mood = 'happy') {
    const mouth = mood === 'wow'
      ? '<ellipse cx="16" cy="25" rx="2.2" ry="2.6" fill="#3a261c"/>'
      : '<path d="M12.5 23.5q3.5 3.2 7 0" stroke="#3a261c" stroke-width="2" fill="none" stroke-linecap="round"/>';
    const span = document.createElement('span');
    span.innerHTML = `<svg class="mascot" width="${size}" height="${size * 1.12}" viewBox="0 0 32 36" aria-hidden="true">
      <path d="M3 3h18l8 8v22H3z" fill="#fffaf2" stroke="#3a261c" stroke-width="2.5" stroke-linejoin="round"/>
      <path class="mascot__ear" d="M21 3v8h8z" fill="#f48f2d" stroke="#3a261c" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="11" cy="18" r="1.9" fill="#3a261c"/><circle cx="21" cy="18" r="1.9" fill="#3a261c"/>
      <circle cx="8.5" cy="22" r="1.6" fill="#ffb35c" opacity=".7"/><circle cx="23.5" cy="22" r="1.6" fill="#ffb35c" opacity=".7"/>
      ${mouth}
    </svg>`;
    return span.firstChild;
  }

  function debounce(fn, ms) {
    let t = null;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
    wrapped.flush = (...args) => {
      if (t) { clearTimeout(t); t = null; fn(...args); }
    };
    return wrapped;
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  /** "Error invoking remote method 'x': Error: message" -> "message" */
  function errText(err) {
    return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  window.D = { h, append, clear, icon, mascot, debounce, uid, errText, timeAgo };
})();
