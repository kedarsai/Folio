'use strict';
/* The Summary: every highlight and note, by chapter, each linked to its source page. */

(function () {
  const { h, icon, mascot } = window.D;
  const UI = window.UI;
  const api = window.dogear;

  window.Views = window.Views || {};

  window.Views.summary = {
    async mount(root, params, app) {
      const bookId = params.bookId;
      const [book, model] = await Promise.all([api.getBook(bookId), api.getSummary(bookId)]);
      app.setSubtitle(book.meta.title);

      const head = window.Views.book.renderHead(app, book, 'summary', {
        onCapture: (btn) => window.Views.book.doCapture(app, bookId, btn),
        onRenamed: (newId) => app.go('summary', { bookId: newId })
      });

      const pageCount = book.chapters.reduce((n, ch) => n + ch.pages.length, 0);
      const isPdf = model.kind === 'pdf';

      const source = (item, hid) => app.go('book', { bookId, pageId: item.id, flash: hid || null });

      const stat = (value, label) => h('div.sm__stat', h('span.sm__statValue', String(value)), h('span.sm__statLabel', label));

      const tools = h('div.sm__tools',
        h('div.sm__stats',
          stat(model.counts.highlights, 'highlights'),
          stat(model.counts.notes, 'notes'),
          stat(pageCount, 'pages')),
        h('div.sm__actions',
          h('button.btn.btn--sm', { title: 'Save a .md file with the page images beside it', onclick: async () => {
            const res = await app.run(() => api.exportMarkdown(bookId));
            if (res) UI.toast('Markdown exported', 'success');
          } }, icon('download'), 'Markdown'),
          h('button.btn.btn--sm', { title: 'Save a printable PDF', onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            const res = await app.run(() => api.exportPdf(bookId));
            btn.disabled = false;
            if (res) UI.toast('PDF exported', 'success');
          } }, icon('pdf'), 'PDF'),
          h('button.iconBtn', { title: 'Open the book folder (Summary.md lives there)', onclick: () => api.openFolder(bookId) }, icon('folder'))));

      let body;
      if (!model.chapters.length) {
        body = h('div.empty.card.sm__empty',
          mascot(58),
          h('h2', 'Nothing to summarize yet'),
          h('p', 'Highlight lines on your captured pages and jot your thoughts. They collect here, chapter by chapter.'),
          h('button.btn.btn--primary', { onclick: () => app.go('book', { bookId }) }, icon('marker'), 'Go to pages'));
      } else {
        body = h('div.sm__chapters', model.chapters.map((ch) => h('section.sm__chapter',
          h('h2.sm__chapterTitle', h('span.sm__num', String(ch.index)), h('span', ch.title),
            h('span.stamp', `${ch.items.length} page${ch.items.length === 1 ? '' : 's'}`)),
          ch.items.map((item) => h('article.sm__item',
            h('button.sm__thumb', { title: 'Open source page', onclick: () => source(item) },
              h('img', { src: item.url, alt: '', loading: 'lazy' })),
            h('div.sm__text',
              h('div.sm__itemHead',
                h('span.sm__label', item.label),
                h('span.grow'),
                h('button.sm__link', { onclick: () => source(item) }, icon('source'), 'Source'),
                isPdf && item.pdfPage !== null
                  ? h('button.sm__link', { onclick: () => app.run(() => api.openPdf(bookId, item.pdfPage)) }, icon('pdf'), `PDF p. ${item.pdfPage}`)
                  : null),
              item.highlights.map((hl) => [
                h('blockquote.sm__quote', { title: 'Show on the page', onclick: () => source(item, hl.id) }, hl.text),
                hl.note.trim() ? h('p.sm__thought', `↳ ${hl.note}`) : null
              ]),
              item.notes.length ? h('ul.sm__notes', item.notes.map((n) => h('li', n.text))) : null))))));
      }

      root.append(h('div.sm', head.el, tools, h('div.sm__scroll', body)));

      const offs = [
        api.on('capture:done', ({ bookId: id, pageId }) => {
          if (id !== bookId) return;
          UI.snapSound();
          UI.toast('Page captured', 'success', { action: 'View', onAction: () => app.go('book', { bookId, pageId }) });
        })
      ];
      return () => offs.forEach((off) => off());
    }
  };
})();
