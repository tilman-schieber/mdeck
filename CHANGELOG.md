# Changelog

## Unreleased

- Fixed: a YouTube video in `<videoplayer>` showed "This video is unavailable" on a device that opened the deck through a server, such as a paired iPad. Such pages send no referrer, which YouTube requires of embedded players; the player now sends the deck's origin (never its path).

## 3.7.1 — 2026-10-09

- A video file on a slide (`<videoplayer src="…" />`) follows the presenter view, on the laptop or a paired iPad: play, pause and a jump there do the same in the audience window, which plays the sound while the presenter view's copy stays silent. This works without a server too, in a built folder. An audience window that nobody has clicked yet plays silently and offers **Click for sound** (German: **Klicken für Ton**). Online videos from YouTube, Vimeo or SwitchTube still play only where they are started; the iPad guide says so.

## 3.7.0 — 2026-10-09

- Palettes have a third accent, `--accent-3`, and the three accents mean something: `--accent` is emphasis, `--accent-2` its companion (gradients, a contrast to the accent), `--accent-3` attention, used sparingly. `--accent-3` marks things and need not be readable as text, so it may be a yellow; `mdeck check` asks only that it can be seen (1.5:1 against the background). A palette without `--accent-3` keeps working and gets an amber (`#d99a00`, at night `#f5c542`); `mdeck check` suggests giving it its own. All built-in palettes and those in the theme repository set it (the repository requires it); `mdeck palettes update` brings installed ones up to date.
- Callouts take their colours from the palette: note, tip and important the accent, warning and caution the third accent. The five callout colours (`--callout-note` … `--callout-caution`) are gone, and with them the green, purple and blue that matched no palette. The built-in themes follow.

## 3.6.2 — 2026-10-09

- The docs home page and the README start with what mdeck does: drawing from an iPad, polls from phones, citations, themes, running code and sending one file, each with a picture (`npm run feature-images` renders them). The docs' example deck is now a short tour of mdeck, with its own control bar and drawing, and a picker of every built-in theme as a picture, with light or dark.
- An embedded deck (`?embedded=1`) shows its control bar with `?controls=1`.
- The reader view has a **Drawings** button when the deck has drawings: it hides and shows them on the slides, in Read and in **Save as PDF**, and the browser remembers the choice. A file made with `mdeck send` opens there, so whoever gets it can see the slides clean.

## 3.6.1 — 2026-10-09

- `mdeck snapshot --sheet` saves one picture of the slides in a grid, each under its number and heading (`my-talk-sheet.png`): a whole deck at a glance, for you or an assistant. It works with `--slide` and `--dark`.
- Fixed: pictures and PDFs could show a slide in its fallback font. mdeck now waits for the theme's font stylesheets and for every face the slides use before it takes a picture, renders a PDF or measures a slide, so `mdeck snapshot`, `mdeck pdf`, `mdeck check --render`, the theme check and the theme repository's previews show the theme's own fonts. Without a network it does not wait.

## 3.6.0 — 2026-10-09

- A theme can say what it is for and how to write for it: a `[guide]` in its `extension.toml` with `suits` and `avoid` (short phrases) and `writing` (a few sentences). `mdeck list` and `mdeck themes search` show what each theme suits, search finds themes by it (`mdeck themes search photo`), and `mdeck list themes --json` and the theme repository's catalogue carry the whole guide. The slide-writing skill chooses a theme by its guide and follows its writing advice, as the theme author's advice and never as instructions. The six built-in themes have guides. A theme with a guide needs this version of mdeck.

## 3.5.0 — 2026-10-09

- mdeck now comes with six themes: `neue` (still the default), `academic` and `minimal` as before, and new among them `plain` (black on white, the heading in a column beside the content), `work` (an everyday company template with an accent band, the logo and numbered sections) and `glass` (liquid glass, dark by default). The palettes `greyscale` (`plain`'s) and `cobalt` (`work`'s) come with it too. `aurora` and its palette `neon` moved to the theme repository: a deck that uses them is told to run `mdeck themes install aurora`; files made with `mdeck send` or `mdeck build` keep working, because they carry their theme. The tour example now uses `glass`.
- Tags in a deck are found the way the slide finds them, everywhere mdeck looks for them: the phones, `--no-polls`, the pictures and videos a build takes along. A `>` in a quoted value no longer cuts a tag short there either (`<qrcode label="a > b" join />`, `<img alt="a > b" src="…">`), and a tag that a blank line cuts in two is no activity for the phones when the slide does not show it.
- Fixed: a bar inside `code`, a [link](…) or a picture in a poll's options split the option in two. Only bars outside them, and outside formulas, separate options.
- A poll's options may be a list inside the tag, one item each, with `[x]` for a right answer: `<poll room="d">` then `- [x] $2x$`, `- [ ] $x^2$` and `</poll>`. Nothing needs escaping, and long options read better than in one attribute.
- Fixed: text after an activity written `<poll … />` (or any component closed with `/>`) went missing from the slide, as did another activity right after it. What follows an activity or a join code now has room above it in every theme.

## 3.4.0 — 2026-10-08

- What follows a list has room above it in every theme, so a sentence after a list no longer sits right against its last item.
- Fixed: a bullet list inside a numbered list took numbers too, and in some themes the number sat on top of the bullet; it also pushed the numbering of the items after it. Every built-in theme now styles only a list's own items.
- A list inside a list item has room above it, as much as between its own items and less than between the outer ones, instead of sitting right against its item. Themes with their own spacing for nested lists keep it.
- Links and quotations look the part in every theme: links take the palette's accent colour instead of the browser's blue, and a `> quotation` is set in each theme's own way instead of as a bare indent: academic as an indented serif quotation, aurora with a quotation mark in its gradient, minimal and neue with a bar at its side (grey and red). A quotation's paragraphs now take the quotation's type, which themes that set every paragraph's font used to undo.
- The sample deck, on which `mdeck design`, the theme gallery and the theme checks show every theme, now also has a link, a quotation, a bullet list inside a numbered list, citations with their references at the foot of the slide, and a reference list.
- A poll's question and options may use Markdown and `$…$` maths, as on a slide: `options="$2x$|$x^2$|$\frac{x^3}{3}$"`. The slide draws them with KaTeX, the phones' answer page as MathML, which needs no fonts or scripts there; it keeps only text, emphasis and MathML from what the presenter's screen sends. A `|` inside a formula belongs to it (`$|x|$`), and `\|` is a bar in the text. Votes and `answer` still use the text as written. The same goes for the `question` of every activity (`<scale>`, `<question>`, `<wordcloud>`) and the scale's `low` and `high` labels. An answer page from an older `mdeck server` shows the source text.
- Fixed: the phones' answer page showed the word “null” below the question when there was no link for following the slides.
- Every activity has a lock button that closes it: answers after that do not count, and the phones say it is closed until it opens again. Together with the eye (`results="hidden"`) and the tick this makes a peer-instruction round: vote, close, show the bars, discuss, show the answer.
- Showing a poll's right answer also tells each phone whether its vote was right, or what the right answer is. The lock, the eye and the tick are kept in the activity room's state on the server, so every screen of the talk and the phones follow them, also after a reload.
- Polls, scales and numbers count “12 of 31 answered” while phones are connected.
- `multiple` lets each phone pick several options of a poll; the slide and the phones say so. `buttons="letters"` (or `"numbers"`) puts A, B, C before the options on the slide and shows only those on the phones, for options that are pictures or long formulas.
- New activity `<numeric>`: phones type a number (`0.5`, `0,5`, `1/2`), the slide shows the most frequent answers as bars. `answer` and `tolerance` mark the right ones and tell each phone whether it was right.
- The answers of a talk are kept beside the deck in `<slides>.results.json` while `mdeck run` runs: anonymous, phones numbered per question. Builds, `mdeck send` and `mdeck pdf` show them as the record of the talk (`--no-results` leaves them out), and `mdeck results` prints them as CSV.
- Fixed: a `>` or `<` in an activity's attributes (`question="Is $x > 0$?"`) cut its tag short, and the phones lost the options. Pictures in a tag's attributes, such as a poll's options, are now copied into folder builds.

## 3.3.0 — 2026-10-08

- Citations and references: `bibliography: refs.bib` in the deck settings, then cite in Pandoc's syntax, `[@smith2020, p. 12]`, `[see @a; @b]`, `[-@a]` or `@smith2020` in a sentence. Each citation shows in the style's short form, each slide lists the full references of the works it cites above its footer (`show.citations: false` leaves them out), and `<bibliography />` lists them all on a slide (`part="1/2"` splits a long list). Reference files may be BibTeX (`.bib`), CSL-JSON (`.json`) or Hayagriva (`.yml`, Typst's format), several at once. `csl:` picks the style, `apa` by default, `vancouver`, `harvard1` or any `.csl` file; the style's words follow `lang`. `nocite:` lists works without citing them. Formatting happens at build time, so a deck carries only the finished text. Unknown keys are marked on the slide and reported by `mdeck check`.
- `mdeck check --render` looks at the deck in Chrome: it builds it, shows every slide with all steps revealed, and reports content that does not fit, text cut off at the slide's edge or hard to read on what is behind it, and errors the page reports, each with the slide's number, heading and line. `mdeck snapshot` saves slides as PNG files (`--slide 3,5-7`, `--dark`, `--light`, `-o`; by default in `.mdeck-snapshots/`), so a person or an assistant can look at them. The slide-writing skill uses both.
- New view `?view=follow`: people in the room follow the talk on their phone or laptop. It shows the slide the presenter shows, step by step, and their drawing, read from the stage room without sending anything; people can page back and return with **Back to live**, and never see a slide or step before the presenter shows it. `<qrcode follow />` shows its link on a slide, the phones' answer page links to it (**Follow the slides**), and `mdeck run --network` prints it. It works on the same network with `mdeck run --network`, and anywhere for a deck hosted with a `server` setting. Followers count as phones in the presenter's overview of who is connected.
- Fixed: a web video (YouTube, Vimeo, SwitchTube) in `<videoplayer>`'s click mode went on playing, with sound, after leaving its slide. Leaving the slide now stops it; coming back shows it ready to play.
- Straight lines snap to steps of 15° (horizontal, vertical, 45° …) when they are within 4° of one, both when a held stroke straightens and when an end point is dragged; further off they stay as drawn.
- Polls have a button with an eye that shows or hides the results (bars and counts), also in the audience window and on paired devices. `results="hidden"` starts with them hidden, e.g. for peer instruction; the audience then sees no bars, the presenter's own screens show them faint.
- `--no-polls` leaves slides with a poll, question, word cloud, scale or join code (`<qrcode join />`) out of `mdeck send`, `mdeck build --reader` and `mdeck pdf`. By default they stay as a record of the talk. Drawings stay on their slides.

## 3.2.0 — 2026-10-07

- Pictures written in the text fit on the slide in every theme: a paragraph of nothing but pictures shrinks into the room below the heading instead of running off the slide, keeping its proportions (small pictures keep their size), and several pictures in one paragraph sit side by side. Such paragraphs have the class `pictures`, for themes that set them their own way; a picture in a sentence is left alone.
- Tables have room below them in every theme, so a sentence after a table no longer sits right against it.
- `mdeck themes build` also renders an icon for each theme: its title slide at 96×54 (drawn at twice that, about 3 KB), listed as `icon` in `catalogue.json` and `looks.json`. The theme repository's gallery shows it in its list instead of the palette's colours, which said little about a theme.

## 3.1.0 — 2026-10-07

- Packs are gone: every theme and palette is installed on its own. `mdeck themes install duet` installs the theme with its default palette (`cobalt`), and `mdeck palettes install solarized` a palette; both have `search`, `remove`, `update` and `list`. A palette made for one theme (FHNW's `brand`) brings that theme along and goes with it. A palette an installed theme uses by default is not removed while that theme is there. Installs go into `themes/<id>/` and `palettes/<id>/` of the extensions folder, so a theme and a palette may share a name.
- A theme or palette carries its version, author, licence and the oldest mdeck it needs in its own `extension.toml` (`version`, `author`, `license`, `homepage`, `mdeck`); `pack.toml` is gone. The built-in ones are back in `assets/extensions/themes` and `assets/extensions/palettes`, and are removed and installed again one by one (`theme:aurora` in `~/.mdeck/removed.json`).
- The theme repository has a folder per theme and per palette (`themes/<id>`, `palettes/<id>`) and serves `catalogue.json`; mdeck 3.0 cannot read it. The design page lists themes and palettes to install one by one.
- The palette `candy` works with every theme: raspberry and blue accents that can be read as text; `pop` takes its pastel fills from the palette (`--pop-fill-1`, `--pop-fill-2`, `--pop-line`, `--pop-shadow`, `--pop-ink`), with black shadows in the dark.
- The palettes `graphite` and `ember` are gone from the theme repository: they looked almost the same as the built-in `nordic` and `paper`. A deck that names one is told which to use instead.
- A deck that names a theme or palette that left mdeck in 3.0 is told the command for it, `mdeck themes install duet` or `mdeck palettes install forest`, not "beside the deck".
- Tests run with an empty `MDECK_HOME`, so what is installed on the computer does not change their results.

## 3.0.0 — 2026-10-07

- Every theme and palette now comes in a pack, also those that come with mdeck: `neue`, `academic`, `aurora` and `minimal` (each a theme with its palette) and the palette `lagoon`. `graphite`, close to `nordic`, moved to the theme repository as a pack of its own. They work right away and offline, and can be removed: `mdeck themes remove aurora` hides it from every deck, `mdeck themes install aurora` brings it back without the internet. A newer version from the theme repository replaces the bundled one. A deck without a theme still uses `neue`, and says so when it was removed; the last theme cannot be removed.
- `mdeck themes install <pack>` installs for every deck by default; a slide file, a folder or `--local` installs beside that deck. Packs can require other packs (`requires = ["lagoon"]` in `pack.toml`) for palettes their themes use: installing one installs those too, and removing a pack another one needs is refused. The design page lists the packs you can install, including removed bundled ones, and removes a pack for every deck.
- `mdeck check` no longer warns about themes installed for every deck.
- Fewer built-in looks: the themes `duet` (with `cobalt`), `editorial` (with `terra`), `fhnw` (with `brand`), `terminal` (with `phosphor`) and `sketch` (with `pastel`), and the palettes `ember` and `forest` (as `earth`) and `graphite`, moved to the theme repository as packs. A deck that uses one gets an error that names the command to run, for example `mdeck themes install duet`; files made with `mdeck send` or `mdeck build` keep working, because they carry their theme.
- New theme `minimal`: nothing but the content, in the computer's own fonts (no web fonts, so it works offline), with medium weights, space instead of rules and boxes, and "Chapter 2" as a quiet label above chapter titles. Its default palette is the new `paper`: off-white and near-black with one orange accent, charcoal and a softer orange in the dark.
- The sample deck's picture is a drawing in the palette's colours, and an SVG data URL that uses theme colours is drawn inline like an SVG file. A drawing in a picture's place now takes the space the layout gives it, like a photo, instead of pushing headings aside.
- The launch page of `mdeck run` has a Theme editor tile under Write and learn; it opens the design page of the deck's editor.
- The examples use built-in themes: the Python lesson `academic`, the poll and custom-layout examples `neue`, the docs home page talk `academic`.

## 2.3.0 — 2026-10-07

- mdeck moved to GitHub (<https://github.com/tilman-schieber/mdeck>) and is published on npmjs.com as `mdeck`: install it with `npm install -g mdeck`. The docs are at <https://gh.tschieber.de/mdeck/>. The GitLab project is archived; remove the old package with `npm uninstall -g @tilman.schieber/mdeck`.
- New `mdeck themes`: themes and palettes from the theme repository (<https://github.com/tilman-schieber/mdeck-themes>). `search` lists the packs, `install <pack> [slides.md]` copies one into the deck's `extensions/`, or with `--global` into `~/.mdeck/extensions` for every deck; `update`, `remove` and `list` work on what is installed, and refuse to overwrite files changed by hand without `--force`. Packs hold only `extension.toml` and `styles.css`, fonts only from Google Fonts or Bunny Fonts, and are checked against the checksum the repository lists. The design page lists the repository's packs with pictures and an Install button.
- Extensions installed for every deck are found by every deck; a deck's own extension with the same id replaces one installed for every deck. `mdeck check` warns when a deck uses one, since the slide file then works only on that computer.
- `mdeck themes build <packs> -o <out> --check` builds the repository: it checks each pack, runs the theme check on every theme and palette in it (light and dark, every kind of slide) and renders a picture of each. The theme check behind `npm run test:themes` moved into mdeck for this (`src/build/themeCheck.js`).
- The `write-slides` skill looks in the theme repository before making a theme from scratch.
- New `mdeck design [slides.md | folder]`: a page for looking at themes and palettes and fine-tuning them, instead of the editor's second mode, which both chose and edited them. Its preview shows a sample deck with one slide of every kind, light or dark, in a theme and palette chosen above it, or the deck itself. The pictures in its list show the sample deck too. Without a deck it works on a folder and saves into that folder's `extensions/`, where any deck kept there finds them; no slide file is read or written. In `mdeck edit` it is **Design themes**.
- The design page lists the deck's own themes and palettes first. A built-in one shows what it is and **Copy to customise**, instead of a form that could not be changed; new themes always start as such a copy, new palettes may also start from plain colours. **Use in my deck** puts a theme or palette in the slide file. The theme form groups its tokens into fonts, sizes and spacing, chooses the default palette from a list with its colours, offers palettes with tick boxes, and keeps `styles.css` under *Advanced*. Layouts are no longer edited in the browser; ask the assistant for one, or write it by hand.
- Editor: the deck's look is chosen only in the Deck tab, where themes are pictures of the first slide. **Customise theme** and **Customise palette** open the design page on a copy of the deck's, or on the deck's own.
- The `write-slides` skill also makes themes and palettes: as an extension beside the deck, copied from the closest built-in theme, checked with `mdeck check`, and handed over with `mdeck design` to look at and fine-tune.
- `npm run test:themes` and the design page use the same sample deck (`src/editor/sampleDeck.js`).

## 2.2.0 — 2026-10-07

- Lecture blocks look different from each other in every theme, not only academic and sketch: theorems, lemmas and corollaries in the accent with the statement in italics, definitions in the second accent, and a proof without a box, opening with “Proof.” and ending with ∎ right after its last word (terminal writes `[proof]`, like its other log lines). Aurora's callout titles are readable on light glass too.
- `npm run test:themes` (also in CI) shows every theme, light and dark, on a deck with every built-in layout and kind of content, and fails when content does not fit, text is cut off at the slide's edge or is hard to read on what is behind it, or the page reports an error.
- Callout titles are readable on light and dark slides: their colour is the signal colour mixed with the text colour (warnings were yellow on white in neue, editorial and FHNW).
- Fixed: terminal's chapter slide with a picture was 4 px too tall and cut off at the bottom; sketch's sticky notes are a little more compact, so three fit on a slide.
- Chapter slides say “Kapitel” in German decks (the label `slide.chapter`); layouts get the deck's words with `t` from `mdeck/layout`.
- Fixed: callout titles were English in decks with a regional language code such as `lang: de-CH`.
- `mdeck check` warns about an unknown callout type such as `::: warnign` and suggests the nearest one; types named under `callouts:` count as the deck's own.
- Editor: the deck's palette is chosen from a list that shows each palette's colours in the current light or dark, the theme's own first; light or dark is a sun/moon switch. A palette written out that is also the theme's default shows as chosen instead of an empty field, and switching to a theme that does not offer the deck's palette removes it from the file instead of leaving an error.
- Editor: palettes, themes and layouts are tabs on the left, in a wider column. Like the presenter view, the view tries one look at a time: choosing a theme keeps the palette where the theme offers it, choosing a palette keeps the theme, and the thumbnails show palettes in that theme and themes with that palette. A bar above the preview names the look and applies it to the deck with “Use for this deck”. Palettes the theme does not offer (FHNW offers only its own) are dimmed.
- The presenter view shows the theme, palette and light/dark row by default. Its fold button folds it, like the drawing toolbar, into a round button beside Draw that shows the palette's accent; the choice is remembered.
- The reader view keeps the sender's theme and palette: instead of the Look menu it has one button to switch between light and dark (`reader.themes: false` removes it). Files from `mdeck send` and `mdeck build --reader`, and the page `mdeck pdf` prints, carry only the deck's theme and palette. Other themes in a sent file used to show in fallback fonts, because only the deck theme's fonts are embedded. The labels `reader.look`, `reader.theme`, `reader.colors`, `reader.themeColors`, `reader.resetLook`, `reader.resetLookHint` and `reader.senderLook` are gone.
- New theme `academic`, for lectures: Source Sans with Source Serif for statements, smaller type so a slide holds a definition, a formula and a few points, the heading in the same place on every slide with the rest centred below it, a running head with the section (§), chapter slides with the number beside a rule, booktabs tables, a short rule above footnotes, and key-idea statement slides set like a theorem. Its default palette is `nordic`.
- New theme `sketch`, a sketchbook: Caveat headings and Patrick Hand text on dotted paper (a chalkboard in dark), a marker scribble under headings, arrows as bullets, circled numbers and chapter numbers, highlighter on bold, sticky-note callouts with tape, photos taped in like polaroids, statement slides as speech bubbles and code in a hand-drawn box. The drawn marks take the palette's colours. Its default palette is `pastel`.
- New palette `pastel`: soft pastels in the style of Catppuccin, Latte in light and Mocha in dark, with mauve and peach.
- New callout types for lectures: `definition`, `theorem`, `lemma`, `corollary`, `proof`, `example` and `remark`, labelled in English or German (`Satz`, `Beweis`, `Beispiel` …). Every theme shows them; academic sets theorems in italics and ends a proof with ∎.
- Polls, scales, word clouds and questions in a PDF, an `mdeck send` file or a build without a poll server show their question and options with “Answered live during the talk”, instead of “Phones cannot reach this computer”, empty counts and “0 answers”. A `<qrcode join />` slide says that phones joined there. Printing hides join codes and the presenter's buttons. Results still show whenever a poll server answers.
- Fixed: SVG pictures referenced only in speaker notes are excluded from exports without notes; `--notes` keeps them. Adding or removing themed SVG pictures while previewing refreshes the inline pictures without restarting the server.
- Fixed: with three or more presenter and audience windows, tied navigation changes keep the last winning sender, including forwarded positions, so a late lower-priority change does not take a window back.
- The “Change the look” guide shows every theme: a large preview in its default look, and, in a tab for each theme, its chapter slide in every palette, light and dark (`npm run theme-images` renders them).
- SVG pictures can use the palette's colours (`var(--accent)` …): they are drawn inline and follow the theme, palette and light or dark, in slide text and as the picture of the title, chapter, image-text and full-bleed layouts. Local layouts get the same with `Picture` from `mdeck/layout`. The tour's title picture is such a drawing.
- Fixed: on duet's title slide, emphasis in the subtitle took the background colour and disappeared; it now keeps the slide's text colour, underlined in the second accent, like the headline.
- Fixed: a picture path shown inside a code example (`image: ./img/photo.jpg`, `![…](./img/photo.jpg)`) was replaced by the embedded picture in PDFs, `mdeck send` files and `--single-file` builds, and a large picture could make the PDF time out. Code examples now stay text.
- Fixed: the editorial theme showed two dashes before a statement slide's attribution.
- The guides start from handing your own slides, documents or notes to an AI assistant, and explain the file format so you can read and adjust what it writes. The `write-slides` skill works from source material: it keeps its content and pictures, and says what it left out, moved to the notes or added.
- The browser editor is no longer marked experimental.
- The examples are reworked: the tour has four chapters, more varied layouts and exports to PDF again; the Python lesson gives code more room and something to try on every code slide; each example uses a different theme; the docs home page shows a short talk about lab notebooks. The FHNW example is removed.

## 2.1.0 — 2026-10-06

- Aurora: code blocks no longer have a line of light along their top edge.
- The terminal theme is redesigned as a terminal session: headings are typed at a `~/talk $` prompt, the title waits at a blinking block cursor (still in print and with reduced motion), chapter slides start like a command (`$ ./chapter 2`, the part as a comment), statement slides are printed by `cat`, callouts are log lines (`[tip]`, `[warning]`), lists use `>` and `[1]`, split slides are divided like tmux panes, the footer is a tmux status bar with the deck's title, and code sits in a window with a title bar. Its default palette is the new `phosphor`: green text on near-black with amber, like an old terminal screen, and a printout on paper in light. A faint scanline shows on chapter slides on screen only.
- Aurora: a title slide with an image shows it on the right at full height, with the title at the lower left, instead of a banner below the title that pushed it up into the brightest light.
- Output of run code stays on the slide: when it appears, the code first gets smaller type and then scrolls to make room, and output that is still too long scrolls as well, in the code's type size and with a fade at the lower edge while there is more.
- Fixed: Python code that imports a package Pyodide provides (`numpy`, `pandas` …) failed with `ModuleNotFoundError`; the package now loads before the code runs.
- The duet theme is redesigned as two voices: its two accents take turns on every slide. The footer rule changes colour halfway, list markers and poll bars alternate between the accents, split slides become a dialogue of two tinted colour fields, title slides are the boldest, all in the first accent with a slanted band of the second, chapter slides are cut diagonally (the number on a field of the first accent, a seam of the second, the title beside it), statement slides stand beside a bar in each accent, and callouts carry their title as a tab (tips in the first accent, warnings in the second). Headings are heavier and tighter Zilla Slab. Its default palette is now `cobalt` instead of `neon`, whose second accent is now a vivid orange (`#e8590c`, dark `#ff922b`) instead of a brownish amber.
- The neue theme is redesigned in a Swiss style: large, tight, flush-left type, a rule across the top instead of floating labels, square accent markers, and callouts and code marked by a coloured rule instead of a grey box. Chapter slides set their title in the accent colour at the bottom left, with a large chapter number as a tint on the right, sharing its baseline and clear of the page number; statement slides are inverted. Its default palette is `swiss`: signal red on white. Palettes keep working, using their text-on-accent colour on chapter slides.
- PDFs, `mdeck send` files and `--single-file` builds carry the theme's own fonts (Latin character sets, embedded once even for variable fonts) instead of falling back to system fonts, so they look like the slides on screen, offline too. Fonts are fetched once and cached in `~/.cache/mdeck/fonts` (`MDECK_CACHE_DIR`); without network and cache the build goes on with the fallback fonts and says so.
- The aurora theme is redesigned as northern lights: slanted curtains of light in the palette's accents, strong on title slides and as a faint shimmer on content slides; chapter and statement slides are night skies in the palette's other variant, with the chapter number glowing in the accent gradient. Tips, code and the section label are frosted glass with a gradient edge. The light drifts slowly while presenting, never in print or with reduced motion.
- The editorial theme is redesigned as a magazine spread: a double masthead rule, a centred cover with an ornament, headlines in Newsreader (in place of Playfair Display, calmer and easier to read) with italic emphasis, a drop cap opening the text after a heading, em-dash bullets and italic numerals, callouts as margin notes, code set like a figure between hairlines, and statement slides as pull quotes with a large quotation mark, the key words in the accent within the same italic. Chapter slides open like a new section with the number as a Roman numeral (`number: 2` shows II). The chapter layout passes a whole chapter number to themes as `--chapter-number`, for a counter in another style.
- Drawings follow light and dark: on dark slides the pen's red, blue and green are lighter and its black is the palette's text colour (white), also for drawings saved before. The toolbar calls that colour "Text colour".
- Fixed: in the presenter view on a touch screen the draw button could stay off although drawing had started, when the slide frame started it before the presenter view listened.
- Chapter numbers show as written, without a leading zero: `number: 2` shows 2 (write `"02"` for the old look).
- Code that is too tall for its place first gets smaller type, down to 22 px, before it scrolls; most examples now fit whole.
- The presenter view and the reader view switch light and dark with sun and moon icons.
- Code that is taller than its place on a slide no longer runs under the heading: it gets a smaller height and scrolls, with a fade at the lower edge while there is more; editable code scrolls together with its highlighting. Centred columns start at the top when their content is too tall. A slide that is still too full is marked (`data-overflow`) and named in the browser console.
- Colours come only from palettes, and palettes are new: nine families with a light and a dark variant each: `lagoon`, `swiss`, `cobalt`, `nordic`, `graphite`, `terra`, `forest`, `ember` and `neon`. `appearance: light` or `dark` picks the variant; the presenter view and the reader view switch both. Themes use the other variant for inverted slides, so neue's statement slides stay readable in every palette. Each theme names a default palette (neue `swiss`, editorial `terra`, duet and aurora `neon`, terminal `forest`, dark); the FHNW theme uses its own palette `brand` and offers no other.
- Removed: `accent` and `accent2` in decks, the accent colour fields in the presenter view and the editor, colour parameters of themes, and the old palettes `paper`, `sage`, `mono`, `dark-slate`, `dark-ember`, `dark-neon` and `dark-mono`. `mdeck check` says so and lists the palettes to use instead.
- Extension format: a palette has `[light]` and `[dark]` tables with all nine colours (and may be private to a theme with `theme = "…"`); a theme names its default `palette`, may limit `palettes`, sets `appearance` instead of `dark`, and may not set colours in `[tokens]`. `mdeck check` warns when a deck's own palette has colours too close to read.
- Fingers keep operating the deck while drawing: the pencil and the mouse draw, a finger's swipe to the left or right moves the slides, a finger's tap on a stroke selects it, and buttons, polls and other controls on a slide keep working. Fingers draw only with the toolbar's hand button. Gestures are read from pointer events instead of the tap zones, so they work on every touch screen, including iPads whose pencil can hover, and no longer cover controls at the sides of a slide.
- The laser pointer replaces the fading marker: a red dot with a white core and a trail that retracts within a second. It follows a hovering pencil without touching, is shown live in the audience window and on other devices, and is never saved.
- Select and move: a loop around strokes, or a tap on one (a finger's tap with any tool), selects them; the pen drags inside the selection's box to move them, saved in their new place and undone with undo. Delete (or the toolbar's bin) removes the selection. A selection takes the pen with any tool; elsewhere the pen draws.
- Straight lines: holding the pen still for half a second at the end of a stroke makes it a straight line, whose end follows the pen until it lifts. A selected straight line shows handles at its ends; the pen moves them.
- The highlighter has its own colours (yellow, green, pink, blue, orange) and remembers its colour and size apart from the pen's; its strokes are drawn below the pen's.
- The drawing toolbar folds into one button in the bottom right corner (↘), which shows the current tool; drawing goes on while it is folded. Colours and sizes show only for the pen and the highlighter.
- Drawing starts with the laser pointer, and on a touch screen (an iPad) it is on as soon as the presenter view opens, and in the deck as soon as the pencil touches it, with the toolbar folded. A phone or tablet only browsing the deck keeps tapping through it: a tap on the right or left third moves the slides while not drawing. While drawing, the page no longer pans or bounces under the pencil (in the presenter view neither the page around the slide).
- Zoom into a slide: two fingers zoom and move the slide itself, one finger moves a zoomed slide, Ctrl + scroll (a trackpad pinch) zooms at the pointer. Bars, the toolbar and the presenter's controls keep their size, drawings and the laser stay exact, and the audience window and paired devices show the same part. **1:1** or the next slide shows the whole slide again. Safari's page zoom is turned off on the stage and around it.
- `<poll answer="…">`: a button with a tick outlines the right answer's row in green; the audience window and paired devices show it too. Activities show **Reset** all the time (greyed out while there are no answers), also on a touch screen without hover; the audience window shows neither.
- With a standalone server and its key (`MDECK_SERVER_KEY`), `mdeck run` keeps the stage room (position and live drawing between a paired iPad and the audience window) on the local network; only polls and phones go to the server.
- Finished strokes reach the point where the pen lifted (perfect-freehand's `last`, and the final position is kept); strokes trail the pen less while drawn.
- Fixed: when a slide got its id with its first drawing, the audience window and other devices kept the old id, so they showed only that first stroke, and later the laser and the zoom did not match. The new id now reaches every window.
- Fixed: a live stroke could stay on the live layer of a window that was hidden while it ended, showing on every slide. It is now removed by a timer as well, and the live layer is cleared on every slide change.

## 2.0.1 — 2026-10-06

- The split layout's shared heading is styled like every other slide heading; it used the browser's default font and size, outside the slide body that themes style.
- A numbered list right after a bullet list (or the other way round) gets the usual space between them.
- The examples follow the current way of writing: `:::meta` settings and named `:::slot` sides. The showcase is now a tour that shows each feature's Markdown beside its result, from headings to live code, notes, drawing, a poll and sharing. The Python lesson asks a poll to check understanding and invites drawing on the loop; the FHNW deck sets `lang: de`, describes its pictures and no longer uses a removed layout.
- The drawing guide names the buttons as they now look.
- The drawing toolbar fits on one line: its previous/next arrows and the white colour are gone (the deck and the presenter view turn slides as before), amber is replaced by **Accent**, the theme's accent colour, which a drawing keeps following when the palette changes, and the button that stops drawing is an ×.
- The full-screen button shows whether it will enter or leave full screen, and leaves it reliably on older iPad Safari too.
- Polls, scales and the other questions have room above the line with the number of answers; themes' paragraph spacing no longer removes it.
- A presenter or audience window could be pulled back to an earlier slide when both were used quickly one after the other: a reset was reported twice, and the late copy won. Positions between the windows are now ordered.
- Chrome, used for `mdeck pdf` and the checks, gets a time limit per step instead of one for the whole run, so a long deck or check no longer fails at an arbitrary step once the total ran out; a step that hangs names itself.

## 2.0.0 — 2026-10-05

A cleaner interface, and presenting from an iPad on any network. This release renames commands, options, settings and files so that each word means one thing. Everything old stops with a message that names its replacement, so nothing changes silently. Decks, extensions and room servers need the changes in the tables below.

### Presenting from an iPad on any network

`mdeck run --server` presents from an iPad on any network without opening a port on your computer and without hosting the deck. The computer connects out to your server (`mdeck server`), which passes the iPad's requests to it. The slides are never stored there. The pairing code on the launch page then points at your server; drawings are still saved beside the deck, edits reload the iPad, and polls and the audience window use the same server.

Slide and reveal navigation works in both directions between the audience window and the iPad, including the presenter's notes and next-slide preview. Received positions do not echo back. The launch page offers Presenter, Audience and Reader; fullscreen is a control within a view, replacing the separate full-screen deck button.

The address is the option's value, else the deck's `server` setting, else `MDECK_SERVER`; the key is `MDECK_SERVER_KEY`. Only what the presenter and audience pages need is passed on; the launch page, the editor and the rest of your folder are not reachable. The server needs this version, a key, and a web server that passes WebSocket connections on (see the audience guide). New dependency: `ws`. Check it with `npm run test:server`.

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

`mdeck migrate [slides.md] --dry-run` previews updates to deck settings, local extension manifests and imports, and drawings filenames. Applying it preserves unrelated text and creates backups. Conflicts stop it before writing. Metadata notes have been removed and are not migrated. `mdeck check` also reports old settings with their replacements.

The package is version 2.0.0; the serialized registry envelope is schema 2. Extension TOML manifests and drawings remain schema/version 1. Old URL parameters produce an explicit correction, and `MDECK_LIVE_KEY` stops startup with its replacement.

### Also new

- `mdeck build --reader` makes a hosted reader folder with separate media and speaker notes removed; `--notes` keeps them. The launch page’s folder-to-host button uses this mode.
- CLI commands reject unknown flags, missing values and surplus filenames before starting a server or changing outputs.
- Relay access follows the deck’s module graph and referenced assets. Pairing URLs keep the master server key on the laptop; tokens are scoped to a tunnel and its session, and unpairing revokes them.

- Drawing: the icons of the toolbar and the presenter view are redrawn as line icons; the colours have names instead of hex codes; clearing a slide asks in a small popover over the button instead of the browser's confirm dialog.
- The launch page and the guides call the server a server, drawings drawings and layouts layouts.

## 1.4.0 — 2026-10-05

Draw on your slides, also from an iPad, and ask the audience more than polls. A room server started with `mdeck live` needs 1.4 to pass live drawings to other devices; polls keep working with older ones.

- Slides can carry drawings (ink) from `<deck>.ink.json` beside the deck: pen strokes with pressure and highlighter, drawn above the slide in the deck, the reader view, builds and PDFs. `I` hides them; `mdeck build` and `mdeck pdf` leave them out with `--no-ink`; `mdeck check` reports a broken ink file and drawings for slides that no longer exist.
- Drawing in the full-screen deck: `D` starts it. Pen (with pressure) and highlighter are kept, a marker fades after a few seconds, the eraser removes whole strokes; undo/redo (also Cmd/Ctrl+Z), clear slide, colours and sizes are on a floating toolbar. Once a pen is used, fingers no longer draw unless switched on; tap zones are off while drawing. Until a server saves the ink, it is kept in the browser and can be downloaded as the ink file.
- `mdeck dev` saves drawings in `<deck>.ink.json` as they are made, without reloading the open windows. A slide that gets its first drawing and has no `id:` gets one from its heading, so the drawing stays with it when slides are added or moved; when an id is changed in the editor, the drawing moves along. Drawings from several windows or devices are merged stroke by stroke, and the ink file is backed up once per session in `.mdeck-backups`.
- Drawing in the presenter view: **✎ Draw** (or `D`) turns it on for the current slide, with the toolbar on the slide. The audience window, the next-slide preview and other deck windows in the same browser show strokes while they are drawn, the marker fading there too.
- For an iPad: the presenter view has a layout where the slide fills the screen, with a small bar (timer, previous/next, draw, notes, full screen) and the notes and next slide in a drawer (`N`). It is the default on touch screens and is remembered. `F` and a button go full screen where the browser allows it, in the presenter view and the deck. The deck's controls gain a draw button, the ink toolbar has previous/next, and buttons are larger on touch screens. Added to the Home Screen, a deck opens without Safari's bars.
- Present from an iPad while the laptop drives the projector: with `mdeck dev --host`, the launch page shows a one-time QR code ("Present from an iPad") that opens the presenter view on the iPad, paired with the dev server so it may save drawings and steer the phones; "Unpair" ends it. The audience window follows a presenter view on another device, slide, step and drawings as they are drawn, through the room server (the one in `mdeck dev` or `mdeck live`, with its presenter code). A window that opens later gets the drawings made so far.
- The room server orders the presenter's announcements by when it heard them, so two devices with clocks that disagree no longer take the phones back to an older slide. New route `POST /rooms/<id>/ink` (presenter only) for live drawings.
- More kinds of audience questions: `<scale>` (a number from `min` to `max`, with counts and the average), `<wordcloud>` (a real word cloud of short answers, packed around the middle and sized by how often they came in) and `<question>` (open answers as cards). Phones answer them on the same page as polls.
- `<qrcode join />` shows the deck's join code, large and with its link, for a slide at the start; `qr="false"` on a poll or another question leaves out its own code.
- QR codes (`<qrcode>` and the questions) are drawn as SVG in the slide's own colours instead of black on white, so they fit dark themes too; `--qr-ink` and `--qr-bg` override them.

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
- The presenter view and the launch page show what is connected to the deck: presenter views, audience windows and phones, and on which devices, such as a paired iPad. Windows say what they are when they connect to the room server; the launch page asks `GET /rooms/<id>/presence`. A standalone `mdeck server` needs this version for it.
- The launch page explains that the iPad runs the same presenter view, and that pairing is what lets it save drawings and steer.
- One icon set everywhere: the launch page, presenter, reader, deck controls, drawing toolbar, code blocks and editor use the same line icons ([Lucide](https://lucide.dev), ISC license) instead of a mix of drawings and text symbols.

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
