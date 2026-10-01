# Changelog

## 1.3.2 — 2026-10-01

- Fixed: on plain `http://` network addresses, as with `mdeck dev --host`, browsers offer no `crypto.randomUUID`. A phone on the answer page then got a new identity with every reload, so a changed vote could count twice, and the presenter view did not open at all. Both now use a fallback that works everywhere.

## 1.3.1 — 2026-09-30

- Phones no longer flip between two screens showing the same presentation: the room server follows the screen where the slides were changed last, a screen that only opened does not take over, and the presenter view says when another screen has the phones. A screen that cannot read its theme yet no longer sends an empty look, which made the phones' fonts jump.

## 1.3.0 — 2026-09-30

Polls work without hosting the slides. This changes how phones join; see *Removed*.

- Polls use relay mode: phones no longer load the slides. They open the room server's own answer page at `<server>/<code>`, and the presenter's screen sends it the activity on screen, what the phones should show, the deck's look and the words in its language. You present from your own computer with the slides as they are; only the room server has to be reachable, and it works the same inside `mdeck dev` on localhost. The session code comes from the deck (`live.id`, `live.code`).
- Components describe their phone side with a static `phone` function returning a `choice`, `text` or `scale` form; answers arrive as `data.value`.
- The poll guide shows how to keep `mdeck live` running with systemd, and the nginx settings live connections need.
- Removed: `?view=respond` and the `live.audience` setting, which `mdeck check` now reports. Custom activities that drew their own phone page with `respond` now describe it with `phone`.

## 1.2.0 — 2026-09-30

### Launch page

- `mdeck dev` opens a launch page at the dev server's plain address; the slides are at `?view=deck`. It has a live preview of the deck; links to the presenter view and an audience window that belong together, the full-screen deck and the reader view; the visual editor and the guides, started on first click; buttons that build the folder, the file to send and the PDF; and the `mdeck check` results. It uses the same dark styling as the presenter view and the editor, and answers only on this computer.
- `mdeck dev` and `mdeck present` accept `--host` (reachable from phones in the same network), `--port` and `--no-open`.

### Audience polls

- `<poll room=… options=…>` shows live results and a QR code; people vote on their phones and can change their vote. Every poll in a deck shares one answer link, `?view=respond`, and phones follow the presenter to whichever poll is on screen, including a theme picked in the presenter view.
- Rooms run inside `mdeck dev`, or on a room server started with `mdeck live` for hosted decks, set with the `live:` deck setting. Only the presenter moves the phones along and resets polls; on a room server this takes the `MDECK_LIVE_KEY` presenter code, which the launch page shows along with the server's health and the viewers' link. The presenter view says whether phones follow it.
- Answers are anonymous and kept in memory only, with size and rate limits.
- Components can build their own activities with `useRoom` and `QrCode` from `mdeck/live`.
- New example deck `examples/poll` and the guide "Ask your audience".

### Language

- `lang` is the deck's language: built pages are marked with it, and the reader view, the deck controls, polls and the answer page use German or English words to match. The `labels:` setting replaces single words.

### Components

- Decks can share components: the `components:` setting lists extra folders, searched after the deck's own `components/` folder. The dev server watches them and follows changes to the list without a restart.
- PDFs, printouts and the reader's Read mode show interactive slides in their finished state: every step is revealed and slides sit inside `[data-deck-static]`; the stage dispatches `printchange` when printing starts or ends.

### Editing, slides and docs

- The editor keeps a copy of the deck in `.mdeck-backups/` before the first change of each session, the ten newest per deck.
- A slide's `title:` setting names it in the outline for slides without a heading.
- Code blocks stay left-aligned in centred layouts. Step lists have the same spacing as ordinary lists.
- New guide "Views, commands and servers".

### Fixes and maintenance

- Dependencies are up to date with no known vulnerabilities: Vite 8, marked 18, KaTeX 0.18, js-yaml 4.3.
- The launch page and the editor answer on `*.localhost` names, as used by local development proxies.
- A leftover temporary Chrome profile no longer fails `mdeck pdf`.
- The real-browser check runs in CI.

## 1.1.0 — 2026-09-17

- One address parameter selects the view: `?view=deck`, `?view=share`, `?view=presenter`, `?view=audience`, with the short forms `?v=d`, `?v=s`, `?v=p`, `?v=a`. The former `?presenter=1`, `?audience=1` and `?share=1` are gone; launchers, the presenter command and the editor use the new form.
- The reader's Look menu always offers "Reset to default", and every reader button has an icon and the same style.

## 1.0.2 — 2026-09-17

- The reader view no longer shows speaker notes just because the file contains them. Notes appear in Read mode only when the deck sets `share.notes: true`, so one build can serve both the presenter and the people you send the link to.

## 1.0.1 — 2026-09-16

- The slide-writing skill follows the Agent Skills format and works with any assistant; `mdeck skill` installs it for Claude Code, Codex, Cursor, GitHub Copilot and Gemini CLI, or prints it for other tools.
- The skill finds the reference docs in the installed package, asks `mdeck templates` and `mdeck extensions` for the deck's real layouts and looks, and checks its result with `mdeck check`.
- README with rendered example slides and a theme GIF; corrected theme descriptions in the authoring reference; package homepage points at the docs site.

## 1.0.0 — 2026-09-16

The first release. Everything below is included.

- Slides written in Markdown with YAML settings, named content areas and speaker notes.
- Seven built-in layouts, six themes and eight colour palettes; deck-local templates, themes and palettes described by one `extension.toml` format.
- Presenter view with notes, timer and a synchronised audience window.
- Reader view for shared decks: outline, Read mode for phones, look picker, deep links, PDF download; `mdeck build --share` strips speaker notes and renders the PDF with a local Chrome.
- `mdeck pdf` renders a PDF on its own, one page per slide with real text.
- Builds as a folder or as one self-contained HTML file, with optional presenter launchers.
- Browser editor (`mdeck edit`, experimental): outline, live preview, form-based slide and deck settings, autosave with undo, and editors for palettes, themes and templates.
- Validation (`mdeck check`), listings (`mdeck templates`, `mdeck extensions`), a scaffolding wizard (`mdeck new`) and offline documentation (`mdeck docs`).
- A slide-writing skill for Claude Code.
