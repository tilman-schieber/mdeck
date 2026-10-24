# Changelog

## Unreleased

- New activity `<pinpoint>`: phones show a picture and send where people tapped. The slide shows every tap as a dot on the picture; `answer="62% 31% 8%"` (or pixels, `answer="412 230 40"`) is the circle the tick draws, counting the taps inside it and telling each phone whether it hit. The presenter's screen sends the phones the picture through the room server, made smaller, so a server needs this version.
- A paired iPad stays paired when `mdeck run` or the laptop restarts: reload its presenter view. The laptop keeps the pairing in `~/.mdeck/paired/` (one file per deck, readable only by you) and forgets an iPad unused for 30 days; **Unpair** still ends every pairing.

## 3.15.0 — 2026-10-17

- A deck can bring a second logo for dark slides: `logo-dark: ./img/logo-white.png` in `meta` is shown as it is on dark slides, instead of the inverted `logo`.
- `mdeck migrate` is gone: it updated decks from before 2.0. A deck or extension that still uses the old names is told what to change.
- `mdeck snapshot` takes `--no-drawings` and `--no-results`, as build, send and pdf do.
- The **?** button that lists the keys is in the presenter view's iPad layout too.
- Fixed: with a phone clicker paired, the presenter view kept warning "Phones follow another screen" although both showed the same slide; it warns only when the phones show something else.
- Fixed: on a phone, the clicker's top bar overlapped the timer and pushed the settings menu off the screen; freeze (Z) sits in the menu's "During the talk" row there.
- Fixed: a presenter view button that was switched on and off again (draw, black screen, notes, …) kept a light frame; its grey border comes back now.
- Fixed: after the laptop changed networks, join codes and QR codes on the slides and in the presenter view's connections panel kept the old address until a reload; they are read again when the window comes back.
- The editor's **Present** button opens the presenter view of the `mdeck run` that started the editor, with its audience window and phones, and says so.
- The editing guide lists ⌘Y for redo and ← → and PgUp/PgDn for moving between slides.
- Third- and fourth-level headings and a rule (`***`) are set in the theme's type in every theme; before, neue, minimal, academic and glass showed them in the browser's own sizes.
- Fixed: code in a split slide's columns was only smaller in the plain theme; it is in every theme now, in both columns, and a code block's output takes the theme's code size.
- With `show.organization: all` the logo appears on every slide, in the header's line, as the name does; by default it stays on the title slide.
- The appearance pages say that a logo is inverted on dark slides and how a palette keeps it as it is (`"--logo-filter" = "none"` in `[dark]`).
- Fixed: closing the editor tab right after typing could lose the last change; the final save now outlives the page.
- Fixed: a change saved in a second editor tab, or with **Use in my deck** on the design page, was not shown in the first tab, and **Keep my edits** there could overwrite it.
- Fixed: when a save failed, the editor retried every 400 ms with the message flickering; it waits longer each time, keeps the message on show and has **Try again**.
- Fixed: moving or deleting the slide file reloaded the editor into "Could not load the deck"; it keeps your text and saves again once the file is back, and the error page has **Try again**.
- Deck width and height, and a slide's chapter number, are written when you finish typing them, not after each digit; the design page no longer reloads its preview while the theme or palette you are editing is saved.
- The design page uses the editor's status wording; Escape closes its New theme/palette dialog; a theme or palette that does not validate is answered with 400, not 500.
- Fixed: in a lecture hall behind one network address, most answers after the first thirty in ten seconds were refused; phones are limited one by one now.
- Fixed: **Reset** on a poll did not reach the phones, which kept showing their old choice; a phone also forgets its choice after twelve hours, so the same talk given later starts fresh.
- Fixed: a poll server that restarted while a poll was on screen took that poll's answers out of `my-talk.results.json`, and a closed poll could take new answers after the restart.
- Fixed: `mdeck run --server` gave up for good when the web server in front of the room server answered 502 while it restarted; it tries again now, and notices a connection that died while the laptop slept.
- Fixed: a bad answer from the presenter's computer could stop `mdeck server`; a full room server answers a new stream with a proper error and frees rooms nobody has spoken in.
- Phones' random ids no longer appear on the slides' answer stream; "12 of 31 answered" counts the phones that can answer, not laptops following the slides.
- The phones' answer page reads right to left for a deck in Arabic, Farsi or Hebrew, and keeps text typed into a question or word cloud while the poll is locked or the slide changes.
- Fixed: switching the language (L) in the middle of a slide hid the points already shown.
- The presenter view's keys (T, H, L, N, F, Escape) work after a click on the slide too; Home goes to the first slide and End to the last.
- Fixed: the time left on a slide without its own time could read a second more than the time it had.
- Fixed: after a reload of the presenter view, the audience window ignored its slide changes or went back to the first slide.
- Fixed: the hotspot numbers sat in the wrong place after the window was resized with the overview open.
- A key or a click in a frozen audience window lets it follow again, where the presenter went on to, should the presenter view have closed.
- **I** (hide drawings) reaches every screen, as B does; drawing starts with the pen on a computer, and with the laser pointer on a touch screen only; the highlighter brightens the text under it on dark slides instead of muddying it.
- The deck window's control-bar tooltips use the deck's language.
- Fixed: undoing the first drawing on a slide, the one that gave it its `id:`, was not saved; the stroke came back after a reload and in PDFs, and redo failed.
- Fixed: a drawing the server could not save disappeared without a word; a short notice over the slide says so now, and with `mdeck run` a batch refused part-way no longer leaves the earlier strokes unwritten.
- A deck in several languages shows its drawings in every language, and strokes drawn in another language are saved with the slide at the same place; the drawings file stays with the file `mdeck run` was started with.
- Fixed: Ctrl+C right after a stroke or an answer could lose it; `mdeck run` writes drawings and answers before it stops, also with `--server`.
- Fixed: on an iPad that lost its Wi-Fi, saving drawings retried without pause; it waits longer after each failed attempt now. `mdeck run` refuses malformed or oversized drawing changes with 400 instead of failing.
- Fixed: `mdeck check --render` reported a chart's labels as cut off at the edge on every bar chart.
- Fixed: a deck file starting with a byte order mark lost its settings, which became the first slide's text.
- Fixed: citation locators written out (`page 12`, `chapter 3`, `sections 2-3`) were read as `p. age 12`.
- Pictures in `poster`, `srcset` and `url(…)` in a `style`, and links to files beside the deck, are checked, copied by builds and embedded by `--single-file`; `mdeck check` warns when an included file's picture lies outside the deck's folder, names the line where a missing picture is written, and warns of `:::notes` inside another block.
- `mdeck build -o dist/` writes `dist/index.html`; `mdeck check <folder>`, a missing deck named to `list` or `starter`, an unknown command and an unknown layout say what is wrong (the last lists the layouts); `--port` on a busy port says so instead of a stack trace.
- `mdeck new` no longer sets a logo that does not exist, and Ctrl+D ends it cleanly; `mdeck --help` lists `migrate`; `mdeck results` refuses `--summary --json` and a `.csv` file with `--json`.
- A deck's `time:` may be `1h`, `1h30` or `1h30m`; the presenter view tells a poll server apart by its patch version too.
- Fixed: on a right-to-left slide, chart labels anchored at an axis landed on the wrong side.
- Fixed: on a phone, the reader's top bar ran off the screen; the buttons show their icons alone.
- A line chart with dates across puts its ticks on years, quarters, months or days, as a scatter chart does; a row without a number or date across is left out and the line joins.
- Fixed: a column with no values could become the row labels; it is left out, and `mdeck check` names it.
- A bar chart's `max` ends the axis exactly there; a taller bar is cut off at the top, and `mdeck check` warns; a chart with many bars labels every second or third, and `mdeck check` warns past 20 bars.
- Fixed: `mdeck check` reported `<data>` problems at the wrong line in a deck that also used HTML's `<data value>`.
- `live` on a code block that is not JavaScript or Python shows no Run button; `<videoplayer url>` takes YouTube Shorts, embed and live links.
- Fixed: a full-bleed-image slide without a picture had a white title on white in dark mode; its text is light on a dark ground in every theme.
- Fixed: in the plain theme, a list item with bold words in its middle was set as a title with a description; only an item that begins in bold is.
- Fixed: on a neue focus slide, code colours, the third accent and the logo did not follow the inverted colours.
- Fixed: a paragraph of drawings (inline SVG) did not shrink to its room and ran over what followed.
- Fixed: the reader did not fit code blocks to their place, the glass theme's light kept drifting in Read mode, and polls showed their live dot and controls there.
- `stat` writes its figures as the deck's language does; the image-text layout's placeholder is in the deck's language.
- Bars always start at 0: a bar chart's `min` above 0 is ignored, and `mdeck check` warns of it (to start an axis higher, use `show="line"`).
- A line chart's `min` and `max` start and end its axis exactly there; lines beyond are cut off at the edge.
- Line and scatter charts with dates across put their ticks on years, quarters, months or days, labelled in the deck's language.
- A line or scatter row without a number or date in `x` is left out, and `mdeck check` names it; before, it was drawn at the edge.
- HTML's own `<data value="…">` is left as HTML, not read as a dataview.
- `<data src="…"></data>`, with nothing between the tags, shows the file; `show=""` shows the table.
- A `<data>` tag's `class`, `style`, `id` and `data-hotspot` go to its figure.
- A `y` column with no values says so, instead of naming an empty cell.
- A `<data>` table without `y` shows every column, text columns too; before, it left out those that were neither the row labels nor numbers.
- In `<data>`, a comma in a number is always its decimal comma, and numbers have no thousands separators: `7,1` and `7.1` are the same in every file and deck, whatever its language or separator.
- **Z** (freeze) in the presenter view, or its snowflake button, freezes the slide the audience sees: the audience window and the phones keep it while you go on.

## 3.14.0 — 2026-10-14

- On an iPad without full screen, the presenter view fits the part of the window Safari shows.
- Fixed: two quick language switches (L, L) could leave a slide's components in the earlier language and stop the windows updating.
- An iPad that is no longer paired, after a restart of `mdeck run` or **Unpair**, says so over the slide and in its connections panel.
- Fixed: after a restart of `mdeck run`, a newly opened presenter view sent the projector back to the first slide.
- Fixed (since 3.13.0): opening or reloading the presenter view on an iPad sent the laptop back to the first slide after 15 s on one slide.
- Fixed: after the laptop changed networks during `mdeck run --network`, pairing codes and join links led to its old address; the pairing panel names the address now.
- A bin beside a selection of strokes deletes it; on an iPad a stroke tapped with a finger can be deleted without opening the folded toolbar.
- On an iPad the presenter view starts with the drawing toolbar open, in its strip below the slide.
- On an iPad, the presenter view's bar and the open drawing toolbar no longer cover the slide.
- `mdeck --help` lists the commands, one line each; `mdeck <command> --help` shows a command's options. The help no longer suggests `npm link`.
- The launch page asks before dropping answers or drawings; dropped answers are gone for good, while the drawings file as it was at the start of the session stays in `.mdeck-backups/`.
- Fixed: the join code shown with **J** on a paired iPad did not show in the laptop's audience window or on phones following the talk.
- Fixed: two things circled with the laser one after the other were briefly joined by a line on the screen they were drawn on.

## 3.13.0 — 2026-10-13

- The slide-writing skill says what to try when nothing fits, and never to put scripts or styles in slides. The layout manifest and `mdeck/layout` are marked experimental; themes, palettes and `mdeck/component` are stable.
- Data on slides: `<data>` shows a table of numbers (CSV in the tag or a file beside the deck) as a table, chart, key figures or heatmap in the palette's colours.
- Ways to show data are a new kind of extension, `dataview`, with helpers from `mdeck/dataview`; `mdeck list dataviews` lists them.
- The launch page can drop kept answers and, in a new **Drawings** section, drawings per slide or all at once, with a backup in `.mdeck-backups/`; its header lists the deck's languages.
- Fixed: a new presenter view said "Phones follow another screen" after an earlier talk on the same server. Update your poll server for this one.
- The default reactions leave out 🐢; a deck can still list it in `reactions:`.

## 3.12.1 — 2026-10-12

- Fixed: on an iPhone the reaction buttons sat behind Safari's bar. Update your poll server for this one.
- `mdeck --version` (or `-v`) shows which mdeck this is.
- Fixed: with polls on your own server, the presenter view counted no phones.
- Shorter status lines in the presenter view.

## 3.12.0 — 2026-10-12

- In a word cloud each phone counts with one word: a new word replaces its earlier one.
- The poll server reports its version (`/info`), and the presenter view warns when your server runs an older mdeck than your computer.
- With `MDECK_SERVER` and `MDECK_SERVER_KEY` set, `mdeck run` uses your server without `--server` when it answers; `--no-server` leaves it out.
- The presenter view is redesigned: one toolbar of icons under the slide, **This slide** for the slide's own controls, and theme, palette, language and layout in the settings.
- A phone can be a clicker (**Phone clicker** in the presenter view's connections). Pairing moved from the launch page into the presenter view.
- Questions no longer show their own QR code; **J** shows the join code instead. `qr` still adds one, and `qr="false"` is no longer needed.
- **J** shows the join code large over the slide on every screen. The join link and session code moved from the launch page into the presenter view's connections.
- Components can add buttons to the toolbar and the clicker with `data-presenter-control`.
- The laser has a laser-pointer icon, and the presenter view shows mdeck's icon in its tab.
- **B** blacks out the audience's screens, phones included; **B** again, the next key or a click brings the slide back. A clicker's blank button works too.
- **O** shows every slide in a grid to jump to one; in the presenter view the audience keeps its slide until one is picked.
- Reactions: with `reactions: true`, phones get a row of emoji buttons whose taps show in the presenter view, never on the projector.
- The launch page saves a talk's answers as CSV, summary CSV or JSON. `mdeck results` has new columns (`slide,room,kind,question,phone,at,answer`) and takes `--summary` and `--json`.

- `<bibliography keys="smith2020 doe2019" />` lists only these works.
- A deck can include other decks: `:::include ./lectures/02-graphs.md` stands for that file's slides (`slides=3-7` keeps some), with their references, components, times and drawings.
- The number keys are for hotspots only and no longer jump to slides 1–10; type a number into the presenter view's slide number instead.
- **?** shows the keys that work at that moment, over the slide, in the presenter view and a deck window.

## 3.11.0 — 2026-10-12

- Time your talk with `time:` per slide and for the deck; the presenter view counts down. `mdeck rehearse` (or **Rehearse**) times each slide and saves the times into the deck.
- Under `mdeck run`, the presenter view has a button back to the launch page.
- The presenter view's timer reads the clock, so it no longer falls behind and survives a reload. **T** starts and pauses it.
- mdeck's own words come in Arabic too (`lang: ar` or `talk.ar.md`).
- Fixed on right-to-left slides: text in palette-coloured drawings ran out of its box, and Latin-script citations were jumbled next to Arabic text.
- The tour comes in English, German and Arabic (`examples/showcase/slides.en.md`, `.de.md`, `.ar.md`); the poll and citations examples are gone.
- Fixed: on a slide with several `:::slot` areas, a code block in one turned the following areas into code.
- Deck components can share state across slides and windows with `useShared` and `useView` from `mdeck/component`, the first stable API for components.
- Palette-coloured SVG drawings build up by numbered steps (`data-step="1"`, `"2"` …); `data-hotspot` makes a part a hotspot.
- Fixed: a drawing on two slides lost its arrowheads, gradients and `<use>` copies on the second.
- `mdeck check` checks the deck's SVG drawings for missing fallbacks, fixed colours, leaking styles and mixed steps.
- The slide-writing skill draws diagrams as SVG in the palette's colours, built up step by step.
- A deck shared in part (`--slide`, `--no-polls`) keeps its slides' planned time as its `time:`.
- Fixed: a YouTube video in `<videoplayer>` was "unavailable" on a device that opened the deck through a server, such as a paired iPad.
- Fixed: in a deck with polls, slide changes in the presenter view were slow on an iPad with a large deck.
- `--slide 3,5-7` for `mdeck send`, `mdeck build` and `mdeck pdf` keeps only these slides. A `<style>` on a left-out slide moves to the first slide kept.
- Fixed: a stroke or laser trail drawn on a paired iPad could stop short in the audience window.
- Ink and the laser from a paired iPad reach the audience window sooner: about 60 ms instead of 100 to 150 ms.
- The laser's trail stays on every screen while the pen is down, and retracts when lifted.
- The presenter view's slide number is a field: type a number and press Enter to jump there.

## 3.10.1 — 2026-10-11

- Theme settings can be text (`type = "text"`), such as Terminal's prompt; mdeck quotes them for the stylesheet.

## 3.10.0 — 2026-10-11

- Glass has a `motion` setting: `motion: 0` holds its light still. The theme authors' guide names the shared settings `motion` and `texture`.

## 3.9.0 — 2026-10-11

- Theme parameters can declare a `type` (`size`, `number`, `switch`, `choice`, `font`), shown as fitting controls and checked by `mdeck check`. A theme that uses `type` needs this version of mdeck.

## 3.8.0 — 2026-10-11

- Hotspots: with `hotspots: auto` or `marked`, the presenter view numbers a slide's parts and **1**–**9** zoom into one on every screen. **H** toggles them during the talk.
- A talk in several languages is one file per language (`talk.en.md`, `talk.de.md`); the presenter view switches between them with **L**.
- Decks in right-to-left languages (`lang: fa`, `ar`, `he` …) run slides and notes right to left in every theme.
- The presenter view calls the light and dark switch **Mode**.
- The presenter view's next-slide preview keeps the language shown after the last slide or a reload.
- The presenter view shows a palette as a chip of its background and two accents, as the theme gallery does.

## 3.7.1 — 2026-10-09

- A video file in `<videoplayer>` follows the presenter view: play, pause and jumps carry to the audience window, which plays the sound. Online videos do not.

## 3.7.0 — 2026-10-09

- Palettes have a third accent, `--accent-3`, for attention. Palettes without it get an amber, and `mdeck palettes update` updates installed ones.
- Callouts take their colours from the palette; the `--callout-note` … `--callout-caution` colours are gone.

## 3.6.2 — 2026-10-09

- The docs home page and the README start with what mdeck does, with a picture per feature; the docs' example deck is a short tour.
- An embedded deck (`?embedded=1`) shows its control bar with `?controls=1`.
- The reader view has a **Drawings** button to hide or show drawings; files from `mdeck send` open there.

## 3.6.1 — 2026-10-09

- `mdeck snapshot --sheet` saves one picture of all slides in a grid (`my-talk-sheet.png`).
- Fixed: pictures and PDFs could show a slide in its fallback font; mdeck now waits for the theme's fonts.

## 3.6.0 — 2026-10-09

- A theme can say what it suits and how to write for it (`[guide]` in `extension.toml`), shown by `mdeck list` and `mdeck themes search`. A theme with a guide needs this version.

## 3.5.0 — 2026-10-09

- Six built-in themes: `neue` (default), `academic`, `minimal`, and new `plain`, `work` and `glass`. `aurora` and `neon` moved to the theme repository: run `mdeck themes install aurora`.
- Tags are found the same way everywhere mdeck looks for them; a `>` in a quoted value no longer cuts a tag short.
- Fixed: a bar inside `code`, a link or a picture in a poll's options split the option in two.
- A poll's options may be a list inside the tag, with `- [x]` marking right answers.
- Fixed: text after a self-closing activity such as `<poll … />` went missing from the slide.

## 3.4.0 — 2026-10-08

- What follows a list has room above it in every theme.
- Fixed: a bullet list inside a numbered list took numbers too and shifted the numbering after it.
- A nested list has room above it instead of sitting against its item.
- Links take the palette's accent colour, and each theme styles `> quotations` its own way.
- The sample deck for `mdeck design`, the gallery and the theme checks adds a link, quotation, nested list and citations.
- Poll questions and options, and every activity's `question`, may use Markdown and `$…$` maths. An older `mdeck server` shows the source text.
- Fixed: the phones' answer page showed "null" below the question when there was no follow link.
- Every activity has a lock button that closes it to further answers.
- Showing a poll's right answer also tells each phone whether its vote was right; lock, results and answer state are kept on the server.
- Polls, scales and numbers count "12 of 31 answered" while phones are connected.
- `multiple` allows several options per phone; `buttons="letters"` (or `"numbers"`) labels the options.
- New activity `<numeric>`: phones type a number; `answer` and `tolerance` mark the right ones.
- A talk's answers are kept anonymously in `<slides>.results.json`; exports show them (`--no-results` leaves them out), and `mdeck results` prints them as CSV.
- Fixed: a `>` or `<` in an activity's attributes cut its tag short. Pictures in a tag's attributes are now copied into folder builds.

## 3.3.0 — 2026-10-08

- Citations and references: `bibliography: refs.bib` and Pandoc-style citations (`[@smith2020, p. 12]`); slides list the works they cite, `<bibliography />` all of them.
- `mdeck check --render` checks the deck in Chrome for overflow, unreadable text and page errors. `mdeck snapshot` saves slides as PNG files.
- New view `?view=follow`: the audience follows the talk on their own devices, never ahead of the presenter. `<qrcode follow />` shows its link.
- Fixed: a web video in `<videoplayer>`'s click mode kept playing, with sound, after leaving its slide.
- Straight lines snap to 15° steps when within 4° of one.
- Polls have an eye button to show or hide results; `results="hidden"` starts hidden.
- `--no-polls` leaves slides with polls, questions or join codes out of `mdeck send`, `mdeck build --reader` and `mdeck pdf`.

## 3.2.0 — 2026-10-07

- A paragraph of only pictures fits below the heading in every theme, with several pictures side by side (class `pictures`).
- Tables have room below them in every theme.
- `mdeck themes build` renders an icon for each theme (`icon` in `catalogue.json` and `looks.json`).

## 3.1.0 — 2026-10-07

- Packs are gone: themes and palettes are installed one by one (`mdeck themes install duet`, `mdeck palettes install solarized`).
- A theme or palette carries its version, author, licence and minimum mdeck in `extension.toml`; `pack.toml` is gone.
- The theme repository has a folder per theme and palette and serves `catalogue.json`, which mdeck 3.0 cannot read.
- The palette `candy` works with every theme; `pop` takes its pastel fills from the palette (`--pop-fill-1` …).
- The palettes `graphite` and `ember` are gone from the theme repository; a deck naming one is told what to use instead.
- A deck naming a theme or palette removed in 3.0 is told the install command, such as `mdeck themes install duet`.
- Tests run with an empty `MDECK_HOME`, so installed extensions do not affect them.

## 3.0.0 — 2026-10-07

- Every theme and palette comes in a pack, the built-in ones too, which can now be removed (`mdeck themes remove aurora`) and installed again offline.
- `mdeck themes install <pack>` installs for every deck by default; `--local` installs beside the deck. Packs can require other packs.
- `mdeck check` no longer warns about themes installed for every deck.
- The themes `duet`, `editorial`, `fhnw`, `terminal` and `sketch` and the palettes `ember`, `forest` (as `earth`) and `graphite` moved to the theme repository; install them with e.g. `mdeck themes install duet`.
- New theme `minimal`, in system fonts, with the new palette `paper`.
- An SVG data URL using theme colours is drawn inline, and takes the layout's space like a photo.
- The launch page of `mdeck run` has a Theme editor tile.
- The examples use built-in themes.

## 2.3.0 — 2026-10-07

- mdeck moved to GitHub and npmjs.com: install with `npm install -g mdeck`, remove the old package with `npm uninstall -g @tilman.schieber/mdeck`. Docs: <https://gh.tschieber.de/mdeck/>.
- New `mdeck themes`: search, install, update and remove packs from the theme repository (<https://github.com/tilman-schieber/mdeck-themes>).
- Extensions installed for every deck are found by every deck; a deck's own one with the same id wins. `mdeck check` warns about such use.
- `mdeck themes build <packs> -o <out> --check` builds and checks the theme repository; the theme check moved to `src/build/themeCheck.js`.
- The `write-slides` skill looks in the theme repository before making a theme from scratch.
- New `mdeck design [slides.md | folder]` for looking at and fine-tuning themes and palettes, replacing the editor's second mode.
- The design page lists the deck's own looks first and copies built-ins with **Copy to customise**. Layouts are no longer edited in the browser.
- Editor: the deck's look is chosen in the Deck tab; **Customise theme** and **Customise palette** open the design page.
- The `write-slides` skill also makes themes and palettes as extensions beside the deck.
- `npm run test:themes` and the design page use the same sample deck (`src/editor/sampleDeck.js`).

## 2.2.0 — 2026-10-07

- Lecture blocks (theorems, definitions, proofs …) look distinct in every theme.
- `npm run test:themes` (also in CI) checks every theme, light and dark, for overflow, unreadable text and page errors.
- Callout titles are readable on light and dark slides.
- Fixed: terminal's chapter slide with a picture was cut off at the bottom; sketch's sticky notes are more compact.
- Chapter slides say "Kapitel" in German decks; layouts get the deck's words with `t` from `mdeck/layout`.
- Fixed: callout titles were English in decks with a regional language code such as `lang: de-CH`.
- `mdeck check` warns about an unknown callout type such as `::: warnign` and suggests the nearest.
- Editor: the deck's palette is chosen from a list showing each palette's colours; light or dark is a sun/moon switch.
- Editor: palettes, themes and layouts are tabs; one look is tried at a time and applied with "Use for this deck".
- The presenter view shows the theme, palette and light/dark row by default, and can fold it into a button.
- The reader view keeps the sender's theme and palette, offering only light or dark. The labels `reader.look`, `reader.theme`, `reader.colors`, `reader.themeColors`, `reader.resetLook`, `reader.resetLookHint` and `reader.senderLook` are gone.
- New theme `academic`, for lectures, with the palette `nordic`.
- New theme `sketch`, a sketchbook, with the palette `pastel`.
- New palette `pastel`, in the style of Catppuccin.
- New callout types for lectures: `definition`, `theorem`, `lemma`, `corollary`, `proof`, `example` and `remark`.
- Questions in PDFs, sent files and builds without a poll server say "Answered live during the talk" instead of showing empty results.
- Fixed: SVG pictures referenced only in speaker notes are left out of exports without notes.
- Fixed: with three or more presenter and audience windows, a late change could take a window back.
- The "Change the look" guide shows every theme in every palette, light and dark.
- SVG pictures can use the palette's colours (`var(--accent)` …) and follow theme, palette and light or dark.
- Fixed: on duet's title slide, emphasis in the subtitle disappeared.
- Fixed: picture paths inside code examples were replaced by embedded pictures in PDFs and single-file outputs.
- Fixed: the editorial theme showed two dashes before a statement slide's attribution.
- The guides start from handing your material to an AI assistant; the `write-slides` skill works from source material.
- The browser editor is no longer marked experimental.
- The examples are reworked, each with a different theme; the FHNW example is removed.

## 2.1.0 — 2026-10-06

- Aurora: code blocks no longer have a line of light along their top edge.
- The terminal theme is redesigned as a terminal session, with the new default palette `phosphor`.
- Aurora: a title slide's image shows on the right at full height instead of as a banner.
- Output of run code stays on the slide: the code shrinks and scrolls to make room.
- Fixed: Python code importing a Pyodide package (`numpy`, `pandas` …) failed with `ModuleNotFoundError`.
- The duet theme is redesigned as two voices in its two accents; its default palette is now `cobalt` instead of `neon`, and that palette's second accent is a vivid orange.
- The neue theme is redesigned in a Swiss style, with the default palette `swiss`.
- PDFs, `mdeck send` files and `--single-file` builds embed the theme's fonts, cached in `~/.cache/mdeck/fonts` (`MDECK_CACHE_DIR`).
- The aurora theme is redesigned as northern lights.
- The editorial theme is redesigned as a magazine spread. Themes get the chapter number as `--chapter-number`.
- Drawings follow light and dark: pen colours lighten on dark slides, and black becomes "Text colour".
- Fixed: in the presenter view on a touch screen, the draw button could stay off although drawing had started.
- Chapter numbers show without a leading zero: `number: 2` shows 2 (write `"02"` for the old look).
- Code too tall for its place first gets smaller type, down to 22 px, before it scrolls.
- The presenter view and the reader view switch light and dark with sun and moon icons.
- Code taller than its place scrolls instead of running under the heading; a slide still too full is marked `data-overflow`.
- Colours come only from palettes: nine new palettes, each light and dark (`appearance: light` or `dark`), and each theme names a default.
- Removed: `accent` and `accent2` in decks, colour fields and theme colour parameters, and the palettes `paper`, `sage`, `mono`, `dark-slate`, `dark-ember`, `dark-neon` and `dark-mono`. `mdeck check` names replacements.
- Extension format: palettes have `[light]` and `[dark]` tables; themes name a default `palette`, set `appearance` instead of `dark`, and set no colours in `[tokens]`.
- Fingers operate the deck while drawing; pencil and mouse draw. Fingers draw only with the toolbar's hand button.
- The laser pointer replaces the fading marker; it shows live on other screens and is never saved.
- Select strokes with a loop or a tap, drag to move them, and Delete to remove them.
- Holding the pen still for half a second turns a stroke into a straight line, with handles at its ends.
- The highlighter has its own colours and remembers its colour and size; its strokes sit below the pen's.
- The drawing toolbar folds into one button in the bottom right corner.
- Drawing starts with the laser pointer, and is on at once on an iPad. While drawing, the page no longer pans or bounces.
- Zoom into a slide with two fingers or Ctrl + scroll; other screens show the same part, and **1:1** shows the whole slide.
- `<poll answer="…">`: a tick button outlines the right answer in green on every screen. **Reset** is always shown.
- With a standalone server and `MDECK_SERVER_KEY`, `mdeck run` keeps the stage room on the local network; only polls and phones use the server.
- Finished strokes reach the point where the pen lifted, and strokes trail the pen less.
- Fixed: after a slide got its id with its first drawing, other windows showed only that first stroke.
- Fixed: a live stroke could stay on every slide in a window that was hidden while it ended.

## 2.0.1 — 2026-10-06

- The split layout's shared heading is styled like other slide headings.
- A numbered list right after a bullet list (or the other way round) gets the usual space.
- The examples use `:::meta` settings and named `:::slot` sides; the showcase is now a feature tour.
- The drawing guide names the buttons as they now look.
- The drawing toolbar fits on one line: arrows and white are gone, amber becomes **Accent**, and the stop button is an ×.
- The full-screen button shows whether it enters or leaves full screen, and works on older iPad Safari.
- Polls and other questions have room above their answer count.
- A presenter or audience window could be pulled back to an earlier slide when both were used quickly; positions are now ordered.
- Chrome gets a time limit per step instead of per run, so long decks and checks no longer time out.

## 2.0.0 — 2026-10-05

A cleaner interface, and presenting from an iPad on any network. Commands, options, settings and files are renamed; every old name stops with a message naming its replacement.

### Presenting from an iPad on any network

`mdeck run --server` presents from an iPad on any network through your own `mdeck server`, without opening a port or hosting the deck. The server needs this version, a key (`MDECK_SERVER_KEY`) and WebSocket forwarding.

### Breaking changes

Commands:

| Before | Now |
|---|---|
| `mdeck dev`, `mdeck present` | `mdeck run`, which always opens the launch page |
| `mdeck live` | `mdeck server` |
| `mdeck build --share --self-contained -o f.html` | `mdeck send` |
| `mdeck build --share` | `mdeck build --reader` |
| `mdeck build --with-notes`, `--no-pdf` | `mdeck send --notes`, `--no-pdf` |
| `mdeck build --self-contained`, `-S` | `mdeck build --single-file` |
| `mdeck build --presenter-launchers` | `mdeck build --launchers` |
| `mdeck build --pdf`, `--inline-images`, `-I` | removed; use `mdeck pdf` and `--single-file` |
| `mdeck run --host` | `mdeck run --network` |
| `mdeck templates`, `mdeck extensions` | `mdeck list [layouts\|themes\|palettes]` and `mdeck starter <layout>` |
| `--no-ink` | `--no-drawings` |
| `npm run dev`, `npm run present` | `npm start` |

Commands that take `slides.md` use the one in the current folder when you leave it out, and `mdeck preview` takes a folder.

Deck settings:

| Before | Now |
|---|---|
| `design` | `theme` |
| `institution`, `authorDate`, `pageNumbers`, `sections` | `show.organization`, `show.author`, `show.numbers`, `show.sections` |
| `share.themes`, `share.notes` | `reader.themes`, `reader.notes` |
| `live.server`, `live.id`, `live.code` | `server`, `session.id`, `session.code` |
| slide `note:` and `notes:` | removed; write a `:::notes` block |

Names in files, addresses and code:

| Before | Now |
|---|---|
| `<deck>.ink.json` | `<deck>.drawings.json` (use `mdeck migrate`; run and exports report a leftover) |
| `?view=share`, `?v=d`, `?v=s`, `?v=p`, `?v=a` | `?view=reader`; the short forms are gone |
| `MDECK_LIVE_KEY`, `?livekey=` | `MDECK_SERVER_KEY`, `?serverkey=` |
| `kind = "template"` in `extension.toml` | `kind = "layout"` |
| `import … from 'mdeck/template-api'` | `'mdeck/layout'` |
| `examples/custom-templates` | `examples/custom-layouts` |

`mdeck migrate [slides.md] --dry-run` previews the updates to a deck, its extensions and its drawings file; `mdeck check` reports old settings with their replacements.

### Also new

- `mdeck build --reader` makes a hosted reader folder without speaker notes; `--notes` keeps them.
- CLI commands reject unknown flags, missing values and surplus filenames before doing anything.
- The relay serves only the deck's modules and assets; pairing tokens are scoped to a session and revoked on unpairing.

- Drawing: toolbar icons are redrawn as line icons, colours have names, and clearing a slide asks in a small popover.
- The launch page and the guides call the server a server, drawings drawings and layouts layouts.

## 1.4.0 — 2026-10-05

Draw on your slides, also from an iPad, and ask the audience more than polls. A room server (`mdeck live`) needs 1.4 to pass live drawings on.

- Slides can carry drawings from `<deck>.ink.json`, shown in the deck, reader view, builds and PDFs. `I` hides them; `--no-ink` leaves them out.
- Drawing in the full-screen deck: `D` starts it, with pen, highlighter, fading marker, eraser, undo and a floating toolbar.
- `mdeck dev` saves drawings in `<deck>.ink.json` as they are made, and gives slides an `id:` so drawings stay with them.
- Drawing in the presenter view: **✎ Draw** (or `D`); other windows show the strokes live.
- For an iPad: a presenter layout with the slide full screen and notes in a drawer (`N`); `F` goes full screen.
- Present from an iPad while the laptop drives the projector: with `mdeck dev --host`, the launch page shows a pairing QR code.
- The room server orders the presenter's announcements by arrival, so devices with disagreeing clocks no longer move phones back. New route `POST /rooms/<id>/ink`.
- New audience questions: `<scale>`, `<wordcloud>` and `<question>`.
- `<qrcode join />` shows the deck's join code; `qr="false"` on a question leaves out its own code.
- QR codes are drawn as SVG in the slide's colours; `--qr-ink` and `--qr-bg` override them.

## 1.3.2 — 2026-10-01

- Fixed: on plain `http://` network addresses a phone's changed vote could count twice, and the presenter view did not open.

## 1.3.1 — 2026-09-30

- Phones no longer flip between two screens showing the same presentation; the presenter view says when another screen has the phones.

## 1.3.0 — 2026-09-30

Polls work without hosting the slides. This changes how phones join; see *Removed*.

- Polls use relay mode: phones open the room server's answer page at `<server>/<code>` instead of loading the slides. The session code comes from `live.id` and `live.code`.
- Components describe their phone side with a static `phone` function; answers arrive as `data.value`.
- The poll guide shows how to run `mdeck live` with systemd and nginx.
- Removed: `?view=respond` and the `live.audience` setting. Custom activities that used `respond` must describe their phone page with `phone`.

## 1.2.0 — 2026-09-30

### Launch page

- `mdeck dev` opens a launch page with a live preview, links to every view, the editor, build buttons and `mdeck check` results. The slides are at `?view=deck`.
- `mdeck dev` and `mdeck present` accept `--host` (reachable from phones in the same network), `--port` and `--no-open`.

### Audience polls

- `<poll room=… options=…>` shows live results and a QR code; phones vote at `?view=respond` and follow the presenter.
- Rooms run inside `mdeck dev` or on a room server (`mdeck live`, `live:` setting) that takes the `MDECK_LIVE_KEY` presenter code.
- Answers are anonymous and kept in memory only, with size and rate limits.
- Components can build their own activities with `useRoom` and `QrCode` from `mdeck/live`.
- New example deck `examples/poll` and the guide "Ask your audience".

### Language

- `lang` is the deck's language; mdeck's own words follow it in German or English. The `labels:` setting replaces single words.

### Components

- Decks can share components from extra folders listed in `components:`.
- PDFs, printouts and Read mode show interactive slides finished, every step revealed (`[data-deck-static]`, `printchange` event).

### Editing, slides and docs

- The editor keeps a copy of the deck in `.mdeck-backups/` before the first change of each session, the ten newest per deck.
- A slide's `title:` setting names it in the outline for slides without a heading.
- Code blocks stay left-aligned in centred layouts. Step lists have the same spacing as ordinary lists.
- New guide "Views, commands and servers".
- The presenter view and the launch page show what is connected to the deck. A standalone `mdeck server` needs this version for it.
- The launch page explains that the iPad runs the same presenter view, and that pairing lets it save drawings and steer.
- One icon set everywhere: [Lucide](https://lucide.dev) line icons (ISC license).

### Fixes and maintenance

- Dependencies are up to date with no known vulnerabilities: Vite 8, marked 18, KaTeX 0.18, js-yaml 4.3.
- The launch page and the editor answer on `*.localhost` names, as used by local development proxies.
- A leftover temporary Chrome profile no longer fails `mdeck pdf`.
- The real-browser check runs in CI.

## 1.1.0 — 2026-09-17

- One address parameter selects the view: `?view=deck`, `share`, `presenter` or `audience` (short `?v=d` …). `?presenter=1`, `?audience=1` and `?share=1` are gone.
- The reader's Look menu always offers "Reset to default", and every reader button has an icon and the same style.

## 1.0.2 — 2026-09-17

- The reader view shows speaker notes only when the deck sets `share.notes: true`, not just because the file contains them.

## 1.0.1 — 2026-09-16

- The slide-writing skill follows the Agent Skills format; `mdeck skill` installs it for Claude Code, Codex, Cursor, GitHub Copilot and Gemini CLI, or prints it.
- The skill finds the reference docs in the installed package, asks mdeck for the deck's real layouts and looks, and checks its result with `mdeck check`.
- README with rendered example slides and a theme GIF; corrected theme descriptions in the authoring reference; package homepage points at the docs site.

## 1.0.0 — 2026-09-16

The first release. Everything below is included.

- Slides written in Markdown with YAML settings, named content areas and speaker notes.
- Seven built-in layouts, six themes and eight colour palettes; deck-local templates, themes and palettes described by one `extension.toml` format.
- Presenter view with notes, timer and a synchronised audience window.
- Reader view for shared decks: outline, Read mode for phones, look picker, deep links, PDF download; `mdeck build --share` strips speaker notes.
- `mdeck pdf` renders a PDF on its own, one page per slide with real text.
- Builds as a folder or as one self-contained HTML file, with optional presenter launchers.
- Browser editor (`mdeck edit`, experimental): outline, live preview, form-based settings, autosave with undo, and editors for palettes, themes and templates.
- Validation (`mdeck check`), listings (`mdeck templates`, `mdeck extensions`), a scaffolding wizard (`mdeck new`) and offline documentation (`mdeck docs`).
- A slide-writing skill for Claude Code.
