'use strict';
/* Toasts, dialogs and pop-up menus. Hangs off window.UI. */

(function () {
  const { h, icon } = window.D;

  // ---------------------------------------------------------------- toasts
  function toast(text, kind = 'info', { action, onAction, ms = 3200 } = {}) {
    let host = document.getElementById('toasts');
    if (!host) host = document.body.appendChild(h('div#toasts'));
    const el = h(`div.toast.toast--${kind}`, h('span', text),
      action ? h('button.toast__action', { onclick: () => { onAction && onAction(); dismiss(); } }, action) : null);
    host.append(el);
    const dismiss = () => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    };
    setTimeout(dismiss, kind === 'error' ? Math.max(ms, 6000) : ms);
    return dismiss;
  }

  // --------------------------------------------------------------- dialogs
  const openModals = new Set();

  /** Dismiss every open dialog (as if cancelled), e.g. when the screen changes. */
  function closeAll() {
    for (const close of [...openModals]) close(null);
    if (openMenu) openMenu();
  }

  /** Generic modal. `build(close)` returns the body nodes. Resolves with close(value). */
  function modal({ title, build, width = 400 }) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      let closed = false;
      const close = (value) => {
        if (closed) return;
        closed = true;
        openModals.delete(close);
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.add('is-leaving');
        setTimeout(() => backdrop.remove(), 160);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      };
      const card = h('div.modal', { style: { width: `min(${width}px, calc(100vw - 32px))` } },
        h('div.modal__head', h('h3', title), h('button.iconBtn', { title: 'Close', onclick: () => close(null) }, icon('close'))),
        build(close));
      const backdrop = h('div.backdrop', { onmousedown: (e) => { if (e.target === backdrop) close(null); } }, card);
      document.body.append(backdrop);
      openModals.add(close);
      document.addEventListener('keydown', onKey, true);
      const first = card.querySelector('input, textarea, select, .btn--primary');
      if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
    });
  }

  function prompt({ title, label, value = '', placeholder = '', ok = 'Save' }) {
    return modal({
      title,
      build: (close) => {
        const input = h('input.input', { value, placeholder, maxLength: 120 });
        const submit = () => close(input.value.trim() || null);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        return h('div.modal__body',
          label ? h('label.field', h('span.stamp', label), input) : input,
          h('div.modal__foot',
            h('button.btn.btn--ghost', { onclick: () => close(null) }, 'Cancel'),
            h('button.btn.btn--primary', { onclick: submit }, ok)));
      }
    });
  }

  function confirm({ title, body, ok = 'OK', danger = false }) {
    return modal({
      title,
      build: (close) => h('div.modal__body',
        h('p.modal__text', body),
        h('div.modal__foot',
          h('button.btn.btn--ghost', { onclick: () => close(false) }, 'Cancel'),
          h(`button.btn.${danger ? 'btn--danger' : 'btn--primary'}`, { onclick: () => close(true) }, ok)))
    }).then(Boolean);
  }

  // ----------------------------------------------------------------- menus
  let openMenu = null;

  /** items: [{label, icon, onClick, danger, disabled} | 'sep'] */
  function menu(anchor, items) {
    if (openMenu) openMenu();
    const el = h('div.menu', items.map((item) => item === 'sep'
      ? h('div.menu__sep')
      : h(`button.menu__item${item.danger ? '.is-danger' : ''}`, {
          disabled: !!item.disabled,
          onclick: () => { close(); item.onClick(); }
        }, item.icon ? icon(item.icon) : h('span.ico'), h('span', item.label))));
    document.body.append(el);

    const r = anchor.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;

    const onDown = (e) => { if (!el.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      openMenu = null;
    }
    setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    openMenu = close;
    return close;
  }

  // ----------------------------------------------------------------- sound
  let audio = null;
  /** A soft paper "snap" for captures. */
  function snapSound() {
    try {
      audio = audio || new AudioContext();
      const t = audio.currentTime;
      const len = Math.floor(audio.sampleRate * 0.09);
      const buffer = audio.createBuffer(1, len, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = audio.createBufferSource();
      src.buffer = buffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2400;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.35, t);
      src.connect(filter).connect(gain).connect(audio.destination);
      src.start(t);
    } catch (_) { /* sound is a nicety */ }
  }

  window.UI = { toast, modal, prompt, confirm, menu, closeAll, snapSound };
})();
