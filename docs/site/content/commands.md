# Command guide

Type these commands in a terminal. Replace `my-talk.md` with your own slide filename; in a folder that has a `slides.md` you can leave it out. If a folder or filename contains spaces, put the path in quotation marks.

For how the commands, the views and the servers fit together, see [Views, commands and servers](views.html).

## Everyday commands

| Command | Use it to… |
|---|---|
| `mdeck skill --install claude` | Teach your AI assistant to write mdeck slides ([details](claude-skill.html)) |
| `mdeck new` | Make a presentation with guided questions |
| `mdeck run my-talk.md` | Open the launch page: present, edit, check and send from one place; slides reload when you save |
| `mdeck edit my-talk.md` | Edit slides, colors and themes in the browser; saves to the file |
| `mdeck themes search`, `install <theme>`, `remove`, `update`, `list` | Themes: install more (each with its palette), remove the ones you do not use; see [Install, remove or share a theme](theme-repository.html) |
| `mdeck palettes search`, `install <palette>`, … | The same for palettes |
| `mdeck design [my-talk.md or folder]` | Look at themes and palettes on a sample deck and fine-tune them; saves to `extensions/` |
| `mdeck migrate my-talk.md --dry-run` | Preview the changes needed for API 2.0 |
| `mdeck check my-talk.md` | Check settings and look for missing local files; `--render` also finds slides whose content does not fit |
| `mdeck snapshot my-talk.md` | Save pictures of the slides as PNG files, for you or your assistant to look at |
| `mdeck send my-talk.md` | Make one file to send to readers, with a PDF inside |
| `mdeck build my-talk.md` | Make a folder to host in `dist` |
| `mdeck pdf my-talk.md` | Make a PDF |
| `mdeck preview` | Open the last build from the current folder |
| `mdeck server` | Run the server for polls and for presenting from an iPad on any network ([details](audience.html#use-it-in-a-real-session)) |
| `mdeck list`, `mdeck starter` | Look up layouts, themes and palettes |
| `mdeck docs` | Open this documentation |
| `mdeck --help` | Show a short list of commands |

## The launch page

`mdeck run my-talk.md` opens a page on your own computer with everything for this talk. It is what the preview's plain address, such as `http://localhost:5173/`, shows; the slides themselves are at `?view=deck`.

- **Preview:** a small live copy of the deck to flip through; click it to open the audience window at that slide.
- **Present:** the presenter view, audience window and reader view, each in a new tab. The presenter view has notes, drawing controls, a timer and next-slide preview; switch to its slide-only layout for a single screen. The audience window shows slides without notes. Fullscreen is a control inside either view, not a separate view.
- **Write and learn:** the visual editor, the theme editor (themes and palettes on a sample deck, see [Install, remove or share a theme](theme-repository.html)) and these guides. Each starts the first time you click it.
- **Send:** buttons that make the `dist` folder, one file to send, or a PDF, next to your slide file, and show them in your file manager.
- **Polls:** for a deck with polls: the server (built in, or the `server` setting and whether it answers), the join link and session code for phones, and for a server of your own the key that lets your browser move the phones along and reset polls (see below).
- **Check:** the same problems `mdeck check` reports, such as missing pictures.

The key is the one the server was started with. Start `mdeck run` with the same key, for example `MDECK_SERVER_KEY=choose-a-secret mdeck run my-talk.md`, and the launch page shows it, and its presenter and audience buttons open those views with it, so they move the phones along. Local views control this deck through the laptop; paired devices receive only a revocable token. Pairing codes never contain the master key. A hosted presenter can unlock the server separately with `?serverkey=…`; that key is removed from the address as soon as the page has it. It never goes into the slide file, because that file reaches everyone who opens the slides.

Two options make the slides reachable from other devices:

| Option | What it does |
|---|---|
| `--network` | Phones and tablets on the same network can open the slides. |
| `--server` | An iPad on any network can present through your own server. It takes the server's address, or finds it in the deck's `server` setting or in the `MDECK_SERVER` variable, in that order. The key goes in `MDECK_SERVER_KEY`. |

See [Draw on your slides](drawing.html#present-from-an-ipad) for both. The launch page itself and its buttons only work on your own computer. `--port 4000` chooses the port and `--no-open` starts without opening a browser.

## Open a particular guide

```sh
mdeck docs getting-started
mdeck docs sharing
```

Use the page name from its address, without `.html`. The welcome page is `index`.

`mdeck docs --no-open` starts the documentation server without opening a browser. `mdeck docs --port 4200` chooses a port number. If the usual port is busy, mdeck tries another one.

To make a static copy of the documentation site, use `mdeck docs --build`. This saves it in `docs/site/dist` inside the mdeck project, separately from your presentation builds.

## Edit in the browser

```sh
mdeck edit my-talk.md
mdeck edit my-talk.md --no-open
mdeck edit my-talk.md --port 4300
```

The editor opens in your browser and writes every change into the slide file. `--no-open` starts it without opening a browser window; `--port` chooses the port. See [Edit slides in your browser](editing.html).

## Design themes and palettes

```sh
mdeck design my-talk.md
mdeck design                 # in a folder without a deck
mdeck design brand/
```

The design page shows themes and palettes on a sample deck with every kind of slide, light and dark, and lets you copy a built-in one and fine-tune its colours, fonts, sizes and spacing. With a slide file, it saves into the `extensions` folder beside it and can put the result in the deck. With a folder, or nothing, it saves into that folder's `extensions`, where any deck kept there finds them; no slide file is needed. `--no-open` and `--port` work as for `mdeck edit`.

## Output options

| Command | Result |
|---|---|
| `mdeck build my-talk.md` | A folder in `dist` with every view, to host or copy |
| `mdeck build my-talk.md --reader` | A hosted reader folder with speaker notes removed; add `--notes` to retain them, `--no-polls` to leave out the slides with polls and their join codes |
| `mdeck build my-talk.md -o talk.html` | Choose the output filename; local media stays alongside it |
| `mdeck build my-talk.md --single-file -o talk.html` | Embed local images and media in one HTML file of the presentation |
| `mdeck build my-talk.md --launchers` | Include presenter launchers in the folder build |
| `mdeck send my-talk.md` | One file for readers: the reader view, speaker notes removed, a PDF inside |
| `mdeck send my-talk.md --notes` | The same, keeping the speaker notes |
| `mdeck send my-talk.md --no-polls` | The same, leaving out the slides with polls and their join codes |
| `mdeck send my-talk.md --slide 12-30` | The same with only slides 12 to 30 and their drawings; also for `build` and `pdf` |
| `mdeck send my-talk.md --no-pdf` | The same, without rendering the PDF |
| `mdeck pdf my-talk.md -o talk.pdf` | Render the slides to a PDF file (`--no-polls` leaves out the slides with polls) |
| `--no-drawings` | Leave out the drawings from `my-talk.drawings.json`, for `build`, `send` and `pdf` |
| `--no-results` | Leave out the answers kept in `my-talk.results.json`, for `build`, `send` and `pdf`; the polls then show their questions only |
| `mdeck results my-talk.md` | The answers kept during the talk, as CSV; `-o answers.csv` saves them to a file |

See [Send, host or print your slides](sharing.html) for help choosing between them. Unknown options, missing option values and extra filenames stop the command before it changes any output. `--output=path` and `-o path` are both accepted. `mdeck preview --no-open --port 4200` previews without opening a browser and chooses a port.

## Update a deck to API 2.0

```sh
mdeck migrate my-talk.md --dry-run
mdeck migrate my-talk.md
```

The dry run lists changes without writing files. Applying them renames deck settings, changes local extension manifests from `template` to `layout`, updates `mdeck/template-api` imports in local extensions and components, and renames `<deck>.ink.json` to `<deck>.drawings.json`. Unrelated source text and comments stay unchanged. Speaker notes use `:::notes` blocks; there is no migration for metadata notes.

Conflicting old and new values, or two drawings files, stop the whole migration before any writes. Originals are copied into `.mdeck-backups/migration-…` beside the deck. Running it again makes no changes. Shared component folders outside the deck are not rewritten; update those imports separately.

## Check more strictly

```sh
mdeck check my-talk.md --strict
```

The ordinary check fails when it finds an error. The strict check also fails when it finds a warning, such as a layout name it does not recognize.

## Check how the slides look

```sh
mdeck check my-talk.md --render
```

This builds the deck and shows every slide in Chrome, with all steps revealed as in a PDF. It reports, by slide, heading and line:

- content that is taller than the slide's room for it;
- text that is cut off at the slide's edge;
- text that is hard to read on a plain background behind it;
- errors the page reports, such as a component that fails.

The check takes a few seconds and needs Chrome or Chromium; set `MDECK_CHROME` to its path if it is not found. It checks the deck in its own appearance. A slide with a problem it cannot measure, such as text on a photo, still needs a look in the preview.

## Pictures of the slides

```sh
mdeck snapshot my-talk.md
mdeck snapshot my-talk.md --slide 3,5-7 --dark
mdeck snapshot my-talk.md --sheet
```

This saves each slide, with all steps revealed, as a 1280×720 PNG file in `.mdeck-snapshots/` beside the deck (`-o` for another folder), named `my-talk-03.png` and so on, and prints the paths. `--slide` picks slides by number; `--dark` and `--light` show that appearance instead of the deck's own. `--sheet` saves one picture instead, `my-talk-sheet.png`: the slides in a grid, each under its number and heading, to see a whole deck at a glance. An AI assistant that reads pictures can use them to look at what it wrote. If you keep your slides in Git, add `.mdeck-snapshots/` to your `.gitignore`.

## Layouts, themes and palettes

```sh
mdeck list layouts my-talk.md
mdeck starter comparison my-talk.md
```

The first lists the layouts available to your talk. The second prints starting text for one layout. `mdeck list layouts --json` prints the layout descriptions in a structured form intended for other tools.

```sh
mdeck list my-talk.md
mdeck list themes my-talk.md
```

The first lists every layout, theme and color palette your talk can use, including any kept in an `extensions` folder beside it. The second lists only themes; `palettes` works the same way. `--json` prints the same information for other tools. The complete registry has `schema: 2` and `layouts`, `themes`, `palettes` and `warnings` fields. A filtered listing such as `list layouts --json` is a map keyed by layout ID. Extension TOML manifests still use `schema = 1`.

## Slides from an AI assistant

```sh
mdeck skill
mdeck skill --install claude codex
mdeck skill --print
```

Installs the slide-writing skill for the assistants you use, or prints it for any other tool. See [Work with an AI assistant](claude-skill.html).

## Why do some examples use Node directly?

`mdeck` is the normal command. After the one-time `npm link` setup, you can use it from any folder.

`node bin/mdeck.js` runs the same program directly from its project folder. It is useful when working on mdeck itself, but it is not a replacement you need to learn for everyday use.

From the project folder, `npm start -- my-talk.md` runs `mdeck run`, and `npm run build -- my-talk.md` builds. These use the same program.
