# Dogear — reading companion — design

Date: 2026-09-13 · Status: approved for implementation

## Purpose

You read a book in Kindle for PC or a PDF reader on the left half of the screen.
Dogear sits on the right half. One click (or a global hotkey) captures the page
you are on. Later — or right away — you step through the captured pages, drag a
highlighter over lines on the screenshot to pull out the exact text, and add your
own thoughts. Everything rolls up into a per-book Summary with a Source link back
to the captured page (and, for PDFs, to the real PDF page).

No AI features. The app only stores your highlights and your notes, as plain
folders and files that you (or Claude, pointed at the folder) can read later.

Single user, Windows 11 only.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| App shape | Standalone Electron app, same design language as Tick (cream paper, 3px ink lines, hard offset shadows, pill buttons, Bahnschrift stamps). |
| Capture | Capture area is set once per book by dragging a box over a frozen screen; every capture grabs that area. Redraw any time. |
| Highlighting | Marker drag on the screenshot, snapping to whole words; exact text is pulled from OCR word boxes. |
| OCR | Windows built-in `Windows.Media.Ocr` via a PowerShell script. Offline, free, word bounding boxes. Prototyped: 100% accurate on a clean sample page, ~0.5 s. |
| Source link | Opens the page in the app with the highlight flashed. PDF books also get "Open in PDF" at that page (Microsoft Edge `file:///…pdf#page=N`). |
| Summary | In-app Summary view, always-current `Summary.md` in the book folder, Export to Markdown, Export to PDF. No AI summaries. |
| Storage | Real folders: one folder per book, one folder per chapter, one PNG + one JSON per page. |

## On-disk layout

Library root defaults to `Documents\Dogear` (changeable in Settings).

```
Documents\Dogear\
  Atomic Habits\                      <- book folder (name = sanitized title)
    book.json                         <- title, kind, pdfPath, capture region, timestamps
    Summary.md                        <- regenerated after every change; readable by humans / Claude
    01 Introduction\                  <- chapter folder: "NN Title"
      001.png                         <- captured page
      001.json                        <- page data (OCR words, label, highlights, notes)
      002.png
      002.json
    02 The Surprising Power of Habits\
      001.png
      001.json
```

App settings (not book data) live in `%APPDATA%\Dogear\settings.json`:
`libraryRoot`, `windowBounds`, `hotkey` (default `Control+Alt+B`), `layout`
(`stack` = image over notes, `side` = image beside notes), `alwaysOnTop`, `lastBook`.

### book.json

```json
{
  "title": "Atomic Habits",
  "kind": "kindle",
  "pdfPath": null,
  "region": { "displayId": "2528732444", "x": 0, "y": 80, "width": 960, "height": 900 },
  "createdAt": "2026-09-13T10:00:00.000Z",
  "updatedAt": "2026-09-13T10:30:00.000Z"
}
```

`region` is in DIP (Electron display coordinates) relative to the display's
bounds. `kind` is `kindle` or `pdf`; `pdfPath` is set only for PDFs.

### NNN.json (page)

```json
{
  "capturedAt": "2026-09-13T10:05:00.000Z",
  "label": "Page 16",
  "pdfPage": 16,
  "ocr": {
    "status": "done",
    "width": 1920, "height": 1800,
    "lines": [ { "words": [ { "t": "Habits", "x": 35, "y": 34, "w": 61, "h": 16 } ] } ],
    "error": null
  },
  "highlights": [
    { "id": "h_…", "from": 0, "to": 7, "text": "Habits are the compound interest of self-improvement.", "note": "", "createdAt": "…" }
  ],
  "notes": [ { "id": "n_…", "text": "Free-form thought about this page", "createdAt": "…" } ]
}
```

- `ocr.status`: `pending` | `done` | `failed`. Word coordinates are image pixels.
- Highlights address words by **flat word index** (reading order across all
  lines, inclusive `from`..`to`). `text` is stored so the summary never needs OCR data.
- `label` is auto-detected from the footer ("Page 16", "Location 1234", a bare
  number) and editable. `pdfPage` is a number for PDF books (auto-filled from a
  numeric label, editable), null otherwise.

Ordering is entirely by the numeric prefixes. Moving/deleting pages and chapters
renumbers files so prefixes stay contiguous.

## Architecture

Electron 33, plain JavaScript (CommonJS), no bundler — same as Tick.
`contextIsolation: true`, `nodeIntegration: false`, one preload bridge.

```
src/
  main/
    main.js          app lifecycle, window, hotkey, IPC wiring
    settings.js      settings.json load/save (atomic write, BOM strip)
    library.js       ALL folder/file operations: books, chapters, pages, renumbering
    capture.js       grab display, crop to region, frozen-screen region picker, black-frame check
    ocr.js           run ocr.ps1 queue (one at a time), parse result
    ocr.ps1          Windows.Media.Ocr -> JSON {width,height,lines[{words[{t,x,y,w,h}]}]}
    summary.js       build Summary.md text and the export HTML (pure functions)
    exporter.js      Markdown export (md + images folder), PDF export (printToPDF)
    pdf.js           open a PDF at a page (Edge, fallback shell.openPath)
  preload/
    preload.js       window.dogear API
  shared/
    words.js         flatten words, index<->rect, range text, label detection (pure; used by main + renderer)
    names.js         sanitize folder names, NN/NNN prefixes, parse "NN Title"
  renderer/
    theme.css        tokens copied from Tick
    app/index.html, app.css, app.js       router + titlebar
    app/views/library.js                  bookshelf, new book dialog, settings
    app/views/book.js                     page view: capture bar, image pane w/ marker, notes pane
    app/views/summary.js                  summary view, source links, exports
    picker/index.html, picker.css, picker.js   frozen-screen region picker
```

Boundaries: `library.js` is the only module that touches book folders. Views never
see file paths except `file://` image URLs handed out by main. `words.js` and
`names.js` are pure and unit-tested.

## Flows

**New book.** Library → New Book → dialog (title, Kindle/PDF, PDF file picker if
PDF) → creates folder + `book.json` + `01 Chapter 1\` → immediately opens the
region picker ("Drag a box around the page") → saves region → opens the book.

**Capture.** Button in the book header or global hotkey (works while Kindle has
focus). Main grabs the region's display via `desktopCapturer`, crops to region at
native pixel density, checks for an all-black frame, writes `NNN.png` + `NNN.json`
(`ocr.status: pending`) into the *current chapter* (the last chapter), notifies
the renderer (page appears, little "snap" pop), then queues OCR. OCR completion
fills `ocr`, auto-detects `label`/`pdfPage` if empty, saves, notifies.

**New chapter.** "+ Chapter" → name prompt → creates next `NN Title` folder;
subsequent captures go there. Chapters can be renamed.

**Review / highlight.** Book view shows one page at a time: image pane + notes
pane, orientation toggle (stack/side). ←/→ keys and buttons step through pages
across chapters. Chapter list in a dropdown. On the image, words are invisible
hit targets scaled to the displayed image; mousedown on a word starts a range,
drag extends it (snapping to words in reading order), mouseup creates the
highlight (yellow marker rects drawn per word, merged per line). Each highlight is
a quote card in the notes pane with an editable "my thought" field and delete.
A free-note box adds page notes. Page tools: edit label / PDF page, move to
chapter, delete page, re-run OCR.

**Summary.** For each chapter, each page that has highlights or notes: page
heading (label), quotes with thoughts, free notes, **Source** (jump to page in
book view, flash highlight) and **Open in PDF** (pdf books with `pdfPage`).
Buttons: Export Markdown, Export PDF, Open book folder.

`Summary.md` (in the book folder) is regenerated after any highlight/note/label/
chapter change. It uses relative image links (`01 Introduction/001.png`) and
`file:///…#page=N` PDF links, so the folder is self-contained.

## Window

Frameless, dark ink titlebar like Tick (brand + book title + pin-on-top toggle +
"snap right" + min/max/close). Default size 620×940, min 420×560; bounds remembered.
"Snap right" moves the window to the right half of the current display's work area.

## Error handling

- OCR failure (engine missing, script error, timeout 30 s): `ocr.status = failed`
  with message; page still usable as an image; "Retry OCR" button.
- All-black capture (DRM-protected window): page is still saved, a banner warns
  "This capture came out black — the reader may block screenshots".
- Region's display no longer attached: capture refuses with a toast and offers
  "Set capture area".
- Hotkey already taken: toast in the library view; capture button still works.
- Corrupt `book.json` / page JSON: book or page shown with a warning, file is
  never overwritten silently (copied to `.corrupt-<ts>` before any rewrite).
- Name collisions (two books with the same title): suffix ` (2)`.
- Windows-illegal characters in titles are replaced; names trimmed to 80 chars.

## Testing

`node --test`:
- `names.test.js` — sanitize, prefixes, parse chapter folder names, collision suffix.
- `words.test.js` — flatten, hit-test point→word, range text, rects per line, label detection.
- `library.test.js` — create book/chapter/page in a temp dir, list, rename, move page
  between chapters with renumbering, delete page/chapter renumbering, update page data.
- `summary.test.js` — Summary.md content for a fixture book (quotes, notes, links, PDF links).
- `ocr.test.js` — runs `ocr.ps1` on a generated PNG (Windows only), asserts words and boxes.

Manual: launch app, create a book, set region, capture, highlight, summary, export.

## Out of scope

AI summaries, sync, Mac/Linux, reading Kindle page numbers via Kindle APIs,
automatic page turning, editing OCR text, tags, search.
