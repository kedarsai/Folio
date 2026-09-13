'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

/** Subscribe to a main-process event; returns an unsubscribe function. */
function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const EVENTS = ['toast', 'book:changed', 'capture:done', 'capture:needRegion', 'win:state'];

contextBridge.exposeInMainWorld('dogear', {
  info: call('app:info'),
  updateSettings: call('settings:update'),
  setHotkey: call('settings:setHotkey'),
  chooseLibrary: call('settings:chooseLibrary'),
  setCurrentBook: call('app:currentBook'),

  listBooks: call('library:list'),
  createBook: call('book:create'),
  getBook: call('book:get'),
  getSummary: call('summary:get'),
  renameBook: call('book:rename'),
  deleteBook: call('book:delete'),
  choosePdf: call('book:choosePdf'),
  pickRegion: call('book:pickRegion'),
  capture: call('book:capture'),

  addChapter: call('chapter:add'),
  renameChapter: call('chapter:rename'),
  deleteChapter: call('chapter:delete'),

  updatePage: call('page:update'),
  movePage: call('page:move'),
  deletePage: call('page:delete'),
  retryOcr: call('page:retryOcr'),

  openPdf: call('pdf:open'),
  exportMarkdown: call('export:markdown'),
  exportPdf: call('export:pdf'),
  openFolder: call('shell:openBookFolder'),

  win: {
    minimize: call('win:minimize'),
    maximize: call('win:maximize'),
    close: call('win:close'),
    snapRight: call('win:snapRight'),
    pin: call('win:pin')
  },

  on(channel, callback) {
    if (!EVENTS.includes(channel)) throw new Error(`Unknown event ${channel}`);
    return on(channel, callback);
  },

  // region picker window
  onPickerImage: (callback) => on('picker:image', callback),
  pickerPicked: call('picker:picked')
});
