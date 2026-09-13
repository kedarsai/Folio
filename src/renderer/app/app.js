'use strict';
/* Router + titlebar. Views register themselves on window.Views as
   { mount(root, params, app) -> unmount | void }. */

(function () {
  const { h, clear, icon, mascot, errText } = window.D;
  const api = window.folio;

  const view = document.getElementById('view');
  const brand = document.getElementById('brand');
  const actions = document.getElementById('tbActions');

  const app = {
    info: null,
    current: null,       // { name, params }
    unmount: null,

    async go(name, params = {}) {
      window.UI.closeAll();
      if (app.unmount) { try { app.unmount(); } catch (e) { console.error(e); } }
      app.unmount = null;
      app.current = { name, params };
      clear(view);
      view.dataset.view = name;
      api.setCurrentBook(params.bookId || null);
      if (!params.bookId) setSubtitle('Reading companion');
      try {
        app.unmount = (await window.Views[name].mount(view, params, app)) || null;
      } catch (err) {
        console.error(err);
        window.UI.toast(errText(err), 'error');
        if (name !== 'library') app.go('library');
      }
    },

    setSubtitle,

    /** Run an async action, toasting any error. Returns the result or undefined. */
    async run(fn) {
      try {
        return await fn();
      } catch (err) {
        console.error(err);
        window.UI.toast(errText(err), 'error');
        return undefined;
      }
    }
  };

  function setSubtitle(text) {
    const sub = brand.querySelector('.stamp');
    if (sub) sub.textContent = text;
  }

  function buildTitlebar() {
    brand.append(
      h('div.tb__mascot', mascot(24)),
      h('div.tb__names', h('strong', 'FOLIO'), h('span.stamp', 'Reading companion'))
    );

    const pinBtn = h('button.tb__btn', { title: 'Keep on top', onclick: async () => {
      const on = await api.win.pin();
      pinBtn.classList.toggle('is-on', on);
      window.UI.toast(on ? 'Folio stays on top' : 'Folio no longer stays on top');
    } }, icon('pin'));
    pinBtn.classList.toggle('is-on', !!app.info.alwaysOnTop);

    actions.append(
      pinBtn,
      h('button.tb__btn', { title: 'Snap to the right half of the screen', onclick: () => api.win.snapRight() }, icon('snap')),
      h('span.tb__gap'),
      h('button.tb__btn', { title: 'Minimize', onclick: () => api.win.minimize() }, icon('min')),
      h('button.tb__btn', { title: 'Maximize', onclick: () => api.win.maximize() }, icon('max')),
      h('button.tb__btn.tb__btn--close', { title: 'Close', onclick: () => api.win.close() }, icon('close'))
    );
  }

  api.on('toast', ({ kind, text }) => window.UI.toast(text, kind));

  async function boot() {
    app.info = await api.info();
    buildTitlebar();
    if (app.info.lastBook) {
      const books = await api.listBooks().catch(() => []);
      if (books.some((b) => b.id === app.info.lastBook)) {
        return app.go('book', { bookId: app.info.lastBook });
      }
    }
    app.go('library');
  }

  window.App = app;
  boot();
})();
