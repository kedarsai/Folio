# Dogear

A reading companion for Windows. Read in Kindle for PC or a PDF reader on the
left half of the screen and keep Dogear on the right. Capture each page with one
click or a hotkey, drag a highlighter across lines on the screenshot to pull out
the exact text, and write your own thoughts next to it. Everything collects into
a per-book **Summary** with links back to the source page.

No AI and no network. Text is read with Windows' built-in OCR, offline. Your
notes are plain files in plain folders.

## Run it

```powershell
npm install
npm start
```

For Start Menu and Desktop shortcuts, run this once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1
# remove them again with -Remove
```

## Reading a book

1. **New book.** Enter a title and pick Kindle or PDF. For a PDF, also choose the
   file so "Open in PDF" can jump to pages.
2. **Set the capture area.** Dogear freezes the screen. Drag a box around the page
   text of your reader, once per book. Redraw it any time from the ⋯ menu.
3. **Capture.** Click **Capture**, or press **Ctrl+Alt+B** from anywhere, even while
   Kindle has focus. The page lands in the current (last) chapter and its text is
   read in the background. Page numbers such as "Page 16" or "Location 1234" are
   picked up from the footer when they're visible. You can edit them by clicking
   the yellow label.
4. **+ Chapter** starts a new chapter, and later captures go into it.
5. **Highlight.** Drag the marker across words on the page. Each highlight becomes
   a quote card where you can type your thought. You can also add free notes for
   the page.
6. **Step through pages** with ← and →, or the arrows in the bar. The layout button
   puts notes under or beside the page, and the divider between them can be dragged.
7. **Summary** lists every highlight and note by chapter.
   - **Source**, or clicking a quote, opens the page with that highlight flashing.
   - **PDF p. N** opens the real PDF at that page in Edge.
   - **Markdown** and **PDF** export the summary.

The title bar has two extra buttons: **pin** keeps Dogear on top, and **snap**
moves it to the right half of the screen.

## Where your notes live

The library defaults to `Documents\Dogear`, and you can change it in Settings:

```
Documents\Dogear\
  Atomic Habits\
    book.json                  title, Kindle/PDF, pdf path, capture area
    Summary.md                 all highlights + notes, rebuilt after every change
    01 Introduction\
      001.png                  the captured page
      001.json                 OCR words, page label, highlights, notes
      002.png
      002.json
    02 The Surprising Power of Habits\
      ...
```

- The folder and file names hold the order. Moving or deleting pages in the app
  renumbers the files.
- `Summary.md` is always up to date, and its links are relative, so the folder
  works on its own. To get an AI-written summary, open a book folder in Claude and
  ask it to read `Summary.md`, or the `*.json` files for full page text under
  `ocr.lines`.
- Deleting a book from the shelf sends its folder to the Recycle Bin.
- App settings are kept separately in `%APPDATA%\Dogear\settings.json`.

## Things to know

- **Capture comes out black.** Some readers block screenshots. Dogear warns you
  when a capture is almost entirely black.
- **Capture area on another monitor.** If that monitor is unplugged, capturing asks
  you to redraw the area.
- **Hotkey conflicts.** If another app already owns Ctrl+Alt+B, change it in
  Settings.
- **Keep Dogear out of the area.** If the capture area overlaps Dogear's own window,
  Dogear warns you, because the window would end up in the screenshot.

## Development

```powershell
npm test          # node --test: names, words, library, summary, OCR (real Windows OCR)
npm run dev       # opens DevTools
```

Layout:

- `src/main/` is the Electron main process:
  - `library.js`: the only module that touches book folders
  - `capture.js`: region picker and screen grab
  - `ocr.ps1` and `ocr.js`: Windows.Media.Ocr
  - `summary.js`: Summary.md and export HTML
  - `exporter.js`, `pdf.js`, `settings.js`
- `src/shared/` holds pure helpers used by both sides: word geometry and label
  detection (`words.js`) and folder naming (`names.js`).
- `src/renderer/` holds the UI in vanilla JS (`app/views/library|book|summary`)
  and the frozen-screen `picker/`.

Test hooks (environment variables): `DOGEAR_USERDATA` and `DOGEAR_LIBRARY` point
the app at throwaway folders. `DOGEAR_SMOKE=<module.js>` runs a script that drives
the window, then quits.

The design spec is in `docs/superpowers/specs/`.
