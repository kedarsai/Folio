'use strict';
/* The bookshelf: every book in the library folder, plus New Book and Settings. */

(function () {
  const { h, clear, icon, mascot, timeAgo } = window.D;
  const UI = window.UI;
  const api = window.folio;

  window.Views = window.Views || {};

  // ---------------------------------------------------------------- helpers
  function basename(p) {
    return String(p || '').split(/[\\/]/).pop();
  }

  /** "Control+Alt+B" from a keydown, or null while only modifiers are held. */
  function acceleratorFrom(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    let key = e.key;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
    if (/^F\d{1,2}$/.test(key)) { /* function keys stand alone fine */ }
    else if (!mods.length) return null;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    else if (key.startsWith('Arrow')) key = key.slice(5);
    return [...mods, key].join('+');
  }

  function prettyHotkey(acc) {
    return String(acc || '').replace('Control', 'Ctrl').split('+');
  }

  // ------------------------------------------------------------- new book
  async function newBookDialog(app) {
    const result = await UI.modal({
      title: 'New book',
      width: 420,
      build: (close) => {
        let kind = 'kindle';
        let pdfPath = null;
        const title = h('input.input.input--big', { placeholder: 'e.g. Atomic Habits', maxLength: 120 });
        const pdfName = h('span.hint', 'No file chosen');
        const pdfRow = h('div.row.newbook__pdf', { hidden: true },
          h('button.btn.btn--sm', { onclick: async () => {
            const file = await app.run(() => api.choosePdf(null));
            if (!file) return;
            pdfPath = file;
            pdfName.textContent = basename(file);
            if (!title.value.trim()) title.value = basename(file).replace(/\.pdf$/i, '');
          } }, icon('pdf'), 'Choose PDF…'),
          pdfName);

        const kindBtn = (value, label, ic) => h('button', {
          'aria-pressed': String(value === kind),
          onclick: (e) => {
            kind = value;
            for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
            pdfRow.hidden = kind !== 'pdf';
          }
        }, icon(ic), label);

        const submit = () => {
          if (!title.value.trim()) { title.focus(); return; }
          if (kind === 'pdf' && !pdfPath) { UI.toast('Choose the PDF file so "Open in PDF" can work.'); return; }
          close({ title: title.value.trim(), kind, pdfPath });
        };
        title.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

        return h('div.modal__body',
          h('label.field', h('span.stamp', 'Title'), title),
          h('div.field', h('span.stamp', 'Reading it in'),
            h('div.seg.seg--wide', kindBtn('kindle', 'Kindle', 'book'), kindBtn('pdf', 'PDF', 'pdf'))),
          pdfRow,
          h('p.hint', 'Next you\'ll drag a box around the page area of your reader, once. Every capture grabs that box.'),
          h('div.modal__foot',
            h('button.btn.btn--ghost', { onclick: () => close(null) }, 'Cancel'),
            h('button.btn.btn--primary', { onclick: submit }, icon('plus'), 'Create book')));
      }
    });
    if (!result) return;

    const book = await app.run(() => api.createBook(result));
    if (!book) return;
    await regionIntro(app, book.id);
    app.go('book', { bookId: book.id });
  }

  /** Explain, then run the region picker. Shared with the book view. */
  async function regionIntro(app, bookId) {
    const go = await UI.modal({
      title: 'Set the capture area',
      width: 400,
      build: (close) => h('div.modal__body',
        h('div.region-intro',
          h('div.region-intro__art',
            h('div.region-intro__screen',
              h('div.region-intro__book', h('span'), h('span'), h('span'), h('span')),
              h('div.region-intro__us', mascot(20)))),
          h('ol.region-intro__steps',
            h('li', 'Open your book in Kindle or the PDF reader.'),
            h('li', 'Put it on the left, Folio on the right.'),
            h('li', 'Drag a box around just the page text.'))),
        h('div.modal__foot',
          h('button.btn.btn--ghost', { onclick: () => close(false) }, 'Later'),
          h('button.btn.btn--primary', { onclick: () => close(true) }, icon('frame'), 'Draw the area')))
    });
    if (!go) return false;
    const res = await app.run(() => api.pickRegion(bookId));
    if (!res) {
      UI.toast('No area set. You can draw it any time from the book.');
      return false;
    }
    if (res.overlapsUs) {
      UI.toast('Heads up: the area overlaps Folio\'s window. Move Folio aside before capturing.', 'error');
    } else {
      UI.toast(`Capture area saved (${res.region.width} × ${res.region.height})`, 'success');
    }
    return true;
  }

  // ------------------------------------------------------------- settings
  async function settingsDialog(app) {
    const info = await api.info();
    await UI.modal({
      title: 'Settings',
      width: 440,
      build: (close) => {
        const folder = h('div.settings__path', info.libraryRoot);
        let pending = info.hotkey;
        const keys = h('div.settings__keys');
        const renderKeys = () => {
          clear(keys);
          prettyHotkey(pending).forEach((k, i) => {
            if (i) keys.append(h('span.hint', '+'));
            keys.append(h('kbd', k));
          });
        };
        renderKeys();
        const status = h('span.hint', info.hotkeyOk ? 'Works from any app.' : 'Could not register this shortcut. Another app may be using it.');
        const recorder = h('button.btn.btn--sm', { onclick: () => {
          recorder.textContent = 'Press keys…';
          const onKey = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') { done(); return; }
            const acc = acceleratorFrom(e);
            if (!acc) return;
            pending = acc;
            renderKeys();
            done();
          };
          const done = () => {
            window.removeEventListener('keydown', onKey, true);
            recorder.textContent = 'Change';
          };
          window.addEventListener('keydown', onKey, true);
        } }, 'Change');

        return h('div.modal__body',
          h('div.field', h('span.stamp', 'Library folder'),
            folder,
            h('div.row',
              h('button.btn.btn--sm', { onclick: async () => {
                const dir = await app.run(() => api.chooseLibrary());
                if (dir) { folder.textContent = dir; UI.toast('Library folder changed', 'success'); }
              } }, icon('folder'), 'Change…'),
              h('button.btn.btn--sm.btn--ghost', { onclick: () => api.openFolder(null) }, 'Open in Explorer')),
            h('p.hint', 'Each book is a folder. Chapters are folders inside it; every page is a PNG plus a JSON file, and Summary.md collects your notes.')),
          h('div.field', h('span.stamp', 'Capture shortcut'),
            h('div.row', keys, h('span.grow'), recorder),
            status),
          h('div.modal__foot',
            h('button.btn.btn--ghost', { onclick: () => close(null) }, 'Close'),
            h('button.btn.btn--primary', { onclick: async () => {
              if (pending !== info.hotkey) {
                const res = await app.run(() => api.setHotkey(pending));
                if (!res) return;
                if (!res.ok) { UI.toast(`${pending} is taken by another app. Try a different combination.`, 'error'); return; }
                UI.toast('Shortcut saved', 'success');
              }
              close(true);
            } }, icon('check'), 'Save')));
      }
    });
  }

  // ------------------------------------------------------------------ view
  function bookCard(app, book, refresh) {
    const more = h('button.iconBtn.shelf__more', { title: 'More', onclick: (e) => {
      e.stopPropagation();
      UI.menu(more, [
        { label: 'Rename', icon: 'edit', onClick: async () => {
          const title = await UI.prompt({ title: 'Rename book', value: book.title });
          if (!title) return;
          if (await app.run(() => api.renameBook(book.id, title))) refresh();
        } },
        { label: 'Open folder', icon: 'folder', onClick: () => api.openFolder(book.id) },
        'sep',
        { label: 'Move to Recycle Bin', icon: 'trash', danger: true, onClick: async () => {
          const ok = await UI.confirm({
            title: 'Delete this book?',
            body: `"${book.title}" and all ${book.pageCount} captured pages go to the Recycle Bin.`,
            ok: 'Delete', danger: true
          });
          if (ok && await app.run(() => api.deleteBook(book.id))) refresh();
        } }
      ]);
    } }, icon('dots'));

    return h('article.shelf__book', { tabIndex: 0,
      onclick: () => app.go('book', { bookId: book.id }),
      onkeydown: (e) => { if (e.key === 'Enter') app.go('book', { bookId: book.id }); } },
      h('div.shelf__cover',
        book.cover
          ? h('img', { src: book.cover, alt: '' })
          : h('div.shelf__blank', mascot(40), h('span', book.title)),
        h('span.shelf__ear')),
      more,
      h('div.shelf__info',
        h('div.shelf__title', book.title),
        h('div.shelf__meta',
          h(`span.pill.pill--${book.kind === 'pdf' ? 'pdf' : 'kindle'}`, book.kind === 'pdf' ? 'PDF' : 'Kindle'),
          h('span', `${book.pageCount} page${book.pageCount === 1 ? '' : 's'}`),
          book.updatedAt ? h('span.shelf__ago', timeAgo(book.updatedAt)) : null)));
  }

  window.Views.library = {
    async mount(root, _params, app) {
      const grid = h('div.shelf__grid');
      const count = h('span.stamp');
      const page = h('div.shelf',
        h('div.shelf__head',
          h('div', h('h1.shelf__h', 'Your shelf'), count),
          h('div.row',
            h('button.iconBtn', { title: 'Settings', onclick: () => settingsDialog(app) }, icon('gear')),
            h('button.btn.btn--primary', { onclick: () => newBookDialog(app) }, icon('plus'), 'New book'))),
        grid);
      root.append(page);

      async function refresh() {
        const books = await app.run(() => api.listBooks());
        if (!books) return;
        clear(grid);
        count.textContent = books.length ? `${books.length} book${books.length === 1 ? '' : 's'}` : '';
        if (!books.length) {
          grid.classList.add('is-empty');
          grid.append(h('div.empty.card.shelf__empty',
            mascot(64, 'wow'),
            h('h2', 'Your shelf is empty'),
            h('p', 'Open a book in Kindle or your PDF reader, snap Folio to the right half of the screen, and start a new book here.'),
            h('div.row',
              h('button.btn', { onclick: () => api.win.snapRight() }, icon('snap'), 'Snap right'),
              h('button.btn.btn--primary', { onclick: () => newBookDialog(app) }, icon('plus'), 'New book'))));
          return;
        }
        grid.classList.remove('is-empty');
        for (const book of books) grid.append(bookCard(app, book, refresh));
      }

      await refresh();
      const onFocus = () => refresh();
      window.addEventListener('focus', onFocus);
      return () => window.removeEventListener('focus', onFocus);
    },
    regionIntro
  };
})();
