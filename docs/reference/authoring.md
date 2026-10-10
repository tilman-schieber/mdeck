# Authoring slides

Decks are plain Markdown files. You can version them in git, open them in any text editor, and diff them like code.

---

## Deck structure

A deck is a single `.md` file. The first block is the **deck frontmatter** — it configures the whole presentation. Each subsequent `---` separator starts a new slide.

```markdown
---
theme: neue
palette: swiss
meta:
  title: "My Talk"
  author: "Jane Smith"
  organization: "Acme"
  date: "2026-05-19"
  logo: ./img/logo.png
width: 1920
height: 1080
---

---
layout: title
---
# First slide.
## A short subtitle.

---
# Second slide.

Some body text here. No frontmatter needed for plain content slides.
```

Each `---` line starts a new slide. Frontmatter is only needed when you want a specific layout or slide metadata (`section`, `note`, `image`, etc.). Plain content slides can follow the `---` separator directly with their markdown content.

### Deck frontmatter fields

| Field | Default | Description |
|---|---|---|
| `theme` | `neue` | Theme name |
| `palette` | _(theme default)_ | Colour palette: `swiss`, `nordic`, `cobalt`, `greyscale`, `lagoon`, `paper`, one installed from the theme repository, or one of your own |
| `appearance` | _(theme default)_ | `light` or `dark`: which variant of the palette the slides use |
| `meta.title` | — | Deck title (shown in footer) |
| `meta.author` | — | Author name (shown in footer) |
| `meta.organization` | — | Organization name (shown in header) |
| `meta.date` | — | Date string (shown in footer) |
| `meta.logo` | — | Path to logo image |
| `width` / `height` | `1920` / `1080` | Slide canvas dimensions in px |
| `show.organization` | `title` | When to show the organization name: `title`, `all`, or `none` |
| `show.author` | `title` | When to show the author and date line: `title`, `all`, or `none` |
| `show.numbers` | `slides` | Slide numbers: `slides` (all except title), `all`, or `none` |
| `show.sections` | `all` | Whether to show section labels in the header: `all` or `none` |
| `lang` | `en` | Language of the deck, such as `en`, `de` or `de-CH`: sets the page language and the words the audience sees (see below) |
| `labels` | — | Replace single words the audience sees (see below) |
| `callouts` | — | Override individual callout titles (see below) |
| `server` | the dev server | Your own server for polls, other audience activities and presenting from an iPad, e.g. `https://rooms.example.org` |
| `session.id` | from the title | Name the session code is derived from |
| `session.code` | from `session.id` | The session code itself, 4 to 8 digits; phones join at `<server>/<code>` |
| `components` | — | Extra folders of Preact components shared between decks, relative to the deck or starting with `~/` |
| `params` | — | Theme-specific color/font overrides (see below) |
| `reader.themes` | `true` | Whether the reader view offers a switch between light and dark (see below) |
| `reader.notes` | `false` | Whether the reader view shows speaker notes under each slide in Read mode |
| `bibliography` | — | Reference file, or a list of them, relative to the deck: `.bib`, `.json` (CSL-JSON) or `.yml` (Hayagriva) (see [Citations](#citations-and-references)) |
| `csl` | `apa` | Citation style: `apa`, `vancouver`, `harvard1`, or a `.csl` file |
| `nocite` | — | References to list without citing them; `['*']` lists the whole file |
| `show.citations` | `true` | `false` leaves out each slide's own references above the footer |

### Theme params

Some themes expose their fonts as settings. Set them under `params:`:

```yaml
params:
  fontDisplay: "Georgia, serif"
```

Available params depend on the theme; `mdeck list themes` shows them. Colours
are not params: they come from the palette.

---

### Reader settings

```yaml
reader:
  themes: false   # no light/dark switch in the reader view
  notes: true     # show speaker notes under each slide in Read mode
```

Views are chosen with one address parameter: `?view=deck`, `?view=reader`,
`?view=presenter`, `?view=audience` or `?view=follow` (the presenter's slide and
ink on another device, read from the stage room; never ahead of the presenter). `mdeck send` produces a file that opens
in the reader view (outline, Read mode, a light/dark switch, PDF download).
The file carries only the deck's own theme and palette, with that theme's
fonts, so readers see the deck as it was made; they can switch between its
light and dark version. `reader.themes: false` removes that switch too.
`mdeck build --reader` bundles the same way. Speaker notes are
removed from `mdeck send` files unless the command uses `--notes`, and even
then the reader shows them only when `reader.notes` is `true`, so a file can
carry notes for the presenter view without showing them to readers. The same
view is reachable in any build through `?view=reader`.

## Available themes

| Key | Description |
|---|---|
| `neue` | Swiss style: Inter Tight and Inter, large flush-left type, a rule across the top, square accent markers, red on white |
| `minimal` | Nothing but the content: the system's own fonts (no web fonts, works offline), medium weights, space instead of rules and boxes |
| `academic` | A lecture: Source Sans and Source Serif, compact type with the heading fixed at the top and the content centred below, theorem and definition blocks, booktabs tables, a footnote rule |
| `plain` | Black on white and lots of room: Inter, the heading in a column of its own beside the content, the accent only in small places |
| `work` | An everyday company template: IBM Plex Sans, an accent band along the top, the logo top left, headings in a fixed place, numbered section dividers, a footer with the page number |
| `glass` | Liquid glass, dark by default: Geist, soft pools of light behind every slide, titles on a frosted pane, glass beads for list markers |

More themes (aurora, duet, editorial, fhnw, terminal, sketch and others) are in the theme
repository: `mdeck themes search` lists them, and
`mdeck themes install <theme> <deck>.md` puts one beside the deck.

`mdeck list <deck>.md` lists the built-in themes together with any themes kept
beside the deck.

---

## Available palettes

Each palette has a light and a dark variant; `appearance:` picks one.

| Key | Light | Dark |
|---|---|---|
| `swiss` | White, black, signal red (neue's default) | Black, white, red |
| `nordic` | Ice grey, navy, steel blue (academic's and glass's default) | Polar night, ice blue |
| `cobalt` | Ultramarine on white, vivid orange (work's default) | Midnight blue, bright blue and orange |
| `greyscale` | Black, white and greys only (plain's default) | The same, inverted |
| `lagoon` | Teal on warm stone | Bright teal on teal-black |
| `paper` | Off-white, near-black, orange (minimal's default) | Charcoal, soft orange |

More palettes (neon, terra, phosphor, pastel, forest, among others)
are in the theme repository; install them with `mdeck palettes install <palette> <deck>.md`.

---

## Slide frontmatter

Each slide can have its own frontmatter block immediately after the `---` separator. Frontmatter is only needed when a slide has specific metadata — layout, image, explicit section label, etc. Plain content slides can omit it entirely.

```markdown
---
layout: chapter
number: 1
part: Part One
description: A short description shown under the title.
---
# Chapter title.
```

### Common slide fields

| Field | Description |
|---|---|
| `layout` | Slide layout (see below) |
| `section` | Section label shown in the slide header (auto-propagated — see below) |
| `title` | Name in the outline and reader navigation, for slides without a heading (not shown on the slide) |

### Section labels

The `section:` field labels the top-right corner of the slide header. It auto-propagates: once set on a slide, all subsequent slides inherit it until a new `section:` is declared or a new chapter starts.

`chapter` slides automatically set the current section to their `part:` value, so slides within a chapter inherit the chapter name without needing explicit `section:` fields.

```markdown
---
layout: chapter
number: 1
part: Methodology
---
# Chapter title.

---
# First slide.
This slide automatically shows "Methodology" in the header.

---
section: Results
---
# Second slide.
This slide shows "Results" — and so does every slide after it until the next chapter or section override.
```

### Speaker notes

Speaker notes are only visible in the presenter view. Use a `:::notes` fenced block anywhere in the slide body — typically at the end:

```markdown
---
layout: focus
eyebrow: Key point
---
# The main statement.

:::notes
This is the central idea. Pause here.

- Bullet one
- Bullet two
:::
```

Notes support full Markdown and are written only in `:::notes` blocks in the slide body.

---

## Layouts

### `title` — Opening slide

Centered headline and subtitle. The `h1` becomes the display headline; `h2` becomes the italic subtitle.

```markdown
---
layout: title
---
# A clean presentation framework.
## Markdown-driven slides with *swappable* design systems.
```

---

### `chapter` — Section divider

Ghost numeral, a short accent rule, chapter label, title, and optional description.

```markdown
---
layout: chapter
number: 1
part: Part One
description: How content, design, and components fit together.
---
# The three-part architecture.
```

| Field | Description |
|---|---|
| `number` | The large ghost numeral |
| `part` | Small uppercase label above the title |
| `description` | Italic description below the title |

---

### `focus` — Statement or quote

Left-aligned large statement with an optional eyebrow label and attribution line.

```markdown
---
layout: focus
eyebrow: Core principle
attribution: Tilman Schieber
---
# Separate *content* from *design* from behaviour.
```

| Field | Description |
|---|---|
| `eyebrow` | Small uppercase label above the statement |
| `attribution` | Small italic credit below |

---

### `image-text` — Image beside text

Left image pane, right text pane.

```markdown
---
layout: image-text
image: ./img/diagram.jpg
section: Architecture
---
## Tokens all the way down.

Change one value and the *whole deck* repaints.
```

| Field | Description |
|---|---|
| `image` | Path to image file |
| `section` | Header label |

---

### `full-bleed-image` — Photograph edge-to-edge

The `h1` appears as a caption over a dark gradient at the bottom of the image.

```markdown
---
layout: full-bleed-image
image: ./img/photo.jpg
---
# A caption over the photograph.
```

---

### `split` — Component beside text

The first block element in the body (any component, image, or paragraph) goes to the left pane; everything else flows to the right.

```markdown
---
layout: split
---
```js
const fib = n => n < 2 ? n : fib(n - 1) + fib(n - 2)
```

# Split layout.
The code block goes left. This heading and text go right.
```

---

### Generic (no layout) — Content slide

No `layout:` field renders a standard content slide. `h1` is the heading; everything below is body content. Frontmatter is optional — omit it entirely for slides that need no metadata:

```markdown
---
# Three key principles

1. **Simplicity** — one idea per slide
2. **Contrast** — separate layers
3. **Rhythm** — consistent spacing
```

Add frontmatter only when you need slide-level metadata:

```markdown
---
section: Content
---
# Three key principles

1. **Simplicity** — one idea per slide
2. **Contrast** — separate layers
3. **Rhythm** — consistent spacing
```

---

## Markdown elements

### Headings

`h1` is the slide heading. `h2` is a subheading. Avoid going deeper — slide typography is not designed for `h3`–`h6`.

### Emphasis

- `*italic*` or `_italic_` → italic, colored in the accent color
- `**bold**` or `__bold__` → bold, in the primary ink color

### Lists

Unordered lists render with a short accent rule as the bullet. Ordered lists use large ghost numerals.

```markdown
- First item
- Second item

1. First step
2. Second step
```

### Footnotes

Define footnotes inline. They render as a small block above the slide footer.

```markdown
This claim needs a source.[^1]

[^1]: The source citation goes here.
```

### Citations and references

Name a reference file in the deck frontmatter and cite its entries by key, in the syntax Pandoc and Quarto use:

```markdown
---
bibliography: refs.bib
csl: apa
---
# Results

As @smith2020 showed, it works [see @smith2020, p. 12; @doe2019].

---
# References

<bibliography />
```

| Written | APA | Vancouver |
|---|---|---|
| `[@smith2020]` | (Smith et al., 2020) | (1) |
| `[@smith2020, p. 12]` | (Smith et al., 2020, p. 12) | (1) |
| `[see @smith2020; @doe2019]` | (see Smith et al., 2020; Doe, 2019) | (1,2) |
| `[-@smith2020]` | (2020) | (1) |
| `@smith2020` | Smith et al. (2020) | Smith et al. (1) |
| `@smith2020 [chap. 3]` | Smith et al. (2020, Chapter 3) | Smith et al. (1) |

- **On the slide** each citation shows in the style's short form, and the full reference of every work the slide cites stands in small type above the footer, after any footnotes. `show.citations: false` leaves those out.
- **`<bibliography />`** lists every cited work, plus those named in `nocite`, in the style's order. A list too long for one slide goes on several: `<bibliography part="1/2" />` on one and `<bibliography part="2/2" />` on the next split it in halves.
- **Locators** after a comma: `p.`/`pp.`, `chap.`, `sec.`, `fig.`, `vol.`, `para.`, `no.`, `l.`, `eq.` and the German `S.`, `Kap.`, `Abb.`, `Bd.`, `Nr.`; a bare number is a page.
- **`@key` without brackets** is a citation only when the key is in the reference file, so e-mail addresses and `@handles` stay text. Citations in code, in links' addresses and in `:::notes` blocks work as in slide text, except that notes show no reference footer.
- **A key that is not in the file** shows as `@key?`, marked, and `mdeck check` and `mdeck build` warn about it.

**Reference files.** `bibliography` takes one file or a list:

| Extension | Format | Comes from |
|---|---|---|
| `.bib` | BibTeX / BibLaTeX | Zotero, JabRef, Google Scholar, most journals |
| `.json` | CSL-JSON | Zotero ("CSL JSON"), Pandoc |
| `.yml`, `.yaml` | Hayagriva (Typst), or CSL-YAML when the file is a list | Typst projects |

**Styles.** `apa`, `vancouver` and `harvard1` are built in. Any other style from the [CSL style repository](https://www.zotero.org/styles) works as a file next to the deck: `csl: nature.csl`. The style's words (`p.`/`S.`, `and`/`und`, `et al.`/`u. a.`) follow the deck's `lang`; English, German, French, Spanish and Dutch are included, other languages fall back to English. Note styles (such as Chicago notes-bibliography) are written for footnotes; on slides an author-date or numeric style reads better.

The references are formatted when the deck is built, so the deck carries only the finished text and works offline; the dev server reformats them when the deck or a reference file changes.

---

## Code blocks

Fenced code blocks are syntax-highlighted. Add flags after the language name for extra behavior:

````markdown
```js live editable copy
const fib = n => n < 2 ? n : fib(n - 1) + fib(n - 2)
console.log(fib(10))
```
````

| Flag | Effect |
|---|---|
| `live` | Adds a Run button; shows the output (`console.log`, `print`) below the block, on the slide: the code gets smaller or scrolls to make room, and long output scrolls |
| `editable` | Makes the block editable in-browser |
| `copy` | Adds a clipboard copy button |

Supported languages include `js`, `python`, `css`, `html`, `json`, `bash`, and any other Prism-supported language.

> Python requires Pyodide, which loads on first run (~10 MB); packages the code imports, such as `numpy` or `pandas`, load with it. JavaScript runs instantly in a sandboxed `Function`.

---

## Tables

Standard GFM table syntax:

```markdown
| Layer     | Format   | Who owns it |
|-----------|----------|-------------|
| Content   | Markdown | Author      |
| Design    | CSS      | Designer    |
| Behaviour | Preact   | Developer   |
```

---

## Math

Inline math: `$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$`

Block math:

```markdown
$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$
```

---

## Callouts

Use `:::` fences with a type keyword. An optional custom title follows the type on the same line.

```markdown
::: note
Use callouts sparingly — one per slide at most.
:::

::: tip Combine with code
Place next to a code block for step-by-step instructions.
:::

::: warning
Callouts interrupt reading flow.
:::
```

Available types: `note`, `tip`, `important`, `warning`, `caution`.

For lectures there are also `definition`, `theorem`, `lemma`, `corollary`, `proof`, `example` and `remark`. Every theme tells them apart: theorems, lemmas and corollaries in the accent with the statement in italics, definitions in the second accent, examples and remarks plain, and a proof without a box, opening with *Proof.* and ending with ∎. Each theme does this in its own style; the academic theme sets them like lecture notes. Number them in the title:

```markdown
::: theorem Theorem 2.4 (Lagrange)
If $H$ is a subgroup of a finite group $G$, then $|H|$ divides $|G|$.
:::

::: proof
The cosets of $H$ partition $G$ and all have $|H|$ elements.
:::
```

### Callout titles

Without a custom title, a callout is labelled after its type. Set `lang: de` in the deck frontmatter to get German defaults (`Hinweis`, `Tipp`, `Wichtig`, `Achtung`, `Vorsicht`, and `Satz`, `Beweis`, `Beispiel`, `Bemerkung` …), or override individual titles:

```yaml
lang: de
callouts:
  warning: "Vorsicht, Falle"
```

A title written after the type on the `:::` line still wins over both.

`mdeck check` warns about other type names, which are usually typos (`::: warnign`). A type of your own, styled with your own CSS as `.callout-<type>`, is fine once it has a title under `callouts:`.

---

## Language

`lang` is the language of the whole deck. The page is marked with it, so screen readers pronounce the slides correctly and browsers hyphenate them. It also picks the words mdeck itself shows the audience: the reader view's buttons, the deck's control bar, polls on the slide and on phones, and callout titles. German (`de`) and English (`en`) are built in; for any other language the words stay English. A regional code such as `de-CH` uses the German words.

The presenter view, the launch page and the editor are tools for the author and always stay English.

To change single words, name them under `labels`:

```yaml
lang: de
labels:
  poll.scan: "Jetzt abstimmen"
  reader.present: "Vollbild"
```

`mdeck check` warns about names that do not exist. `{n}`, `{choice}`, `{command}` and `{setting}` are filled in by mdeck.

| Label | English | German |
|---|---|---|
| `reader.outline` | Outline | Gliederung |
| `reader.untitled` | Slides | Folien |
| `reader.slides` | Slides | Folien |
| `reader.read` | Read | Lesen |
| `reader.appearance` | Light or dark | Hell oder dunkel |
| `reader.light` | Light | Hell |
| `reader.dark` | Dark | Dunkel |
| `reader.downloadPdf` | Download PDF | PDF herunterladen |
| `reader.savePdf` | Save as PDF… | Als PDF sichern… |
| `reader.savePdfHint` | Opens the browser's print dialog; choose Save as PDF | Öffnet den Druckdialog des Browsers; dort „Als PDF sichern“ wählen |
| `reader.present` | Present | Präsentieren |
| `reader.previous` | Previous | Zurück |
| `reader.next` | Next | Weiter |
| `reader.copyLink` | Copy link to this slide | Link zu dieser Folie kopieren |
| `reader.linkCopied` | Link copied | Link kopiert |
| `reader.slide` | Slide {n} | Folie {n} |
| `deck.overview` | Overview | Übersicht |
| `slide.chapter` | Chapter (above a chapter slide's title; `label:` on the slide replaces it) | Kapitel |
| `deck.controls` | Deck controls | Foliensteuerung |
| `deck.previous` | Previous slide | Vorherige Folie |
| `deck.next` | Next slide | Nächste Folie |
| `deck.reset` | Reset | Neustart |
| `deck.resetHint` | Reset to first slide | Zurück zur ersten Folie |
| `poll.scan` | Scan to vote | Scannen und abstimmen |
| `poll.answer` | 1 answer | 1 Antwort |
| `poll.answers` | {n} answers | {n} Antworten |
| `poll.reset` | Reset | Zurücksetzen |
| `poll.live` | Live | Live |
| `poll.offline` | Not connected to the server | Keine Verbindung zum Server |
| `poll.unreachable` | Phones cannot reach this computer. Start with {command}, or set {setting}. | Handys erreichen diesen Computer nicht. Mit {command} starten oder {setting} setzen. |
| `poll.tryHere` | Try the answer page here | Antwortseite hier ausprobieren |
| `poll.pick` | Tap one answer. | Eine Antwort antippen. |
| `poll.thanks` | Thanks! You chose “{choice}”. Tap another to change. | Danke! Gewählt: „{choice}“. Zum Ändern eine andere antippen. |
| `respond.waiting` | The next question will appear here. | Die nächste Frage erscheint hier. |
| `respond.send` | Send | Senden |
| `respond.sent` | Sent. Thank you! | Gesendet. Danke! |
| `join.scan` | Scan to join | Scannen und mitmachen |
| `follow.scan` | Scan to follow the slides | Scannen und Folien mitverfolgen |
| `follow.open` | Follow the slides | Folien mitverfolgen |
| `follow.live` | Live | Live |
| `follow.back` | Back to live | Zur aktuellen Folie |
| `follow.waiting` | The talk has not started yet. | Der Vortrag hat noch nicht begonnen. |
| `follow.tryHere` | Try following here | Mitverfolgen hier ausprobieren |
| `question.empty` | Answers appear here. | Hier erscheinen die Antworten. |
| `scale.average` | Average {n} | Durchschnitt {n} |
| `poll.answeredOf` | {n} of {of} answered | {n} von {of} haben geantwortet |
| `poll.closed` | Closed | Geschlossen |
| `poll.several` | Several answers possible. | Mehrere Antworten möglich. |
| `poll.pickSeveral` | Tap all that apply. | Alle zutreffenden antippen. |
| `poll.thanksSeveral` | Thanks! You chose {choice}. Tap to change. | Danke! Gewählt: {choice}. Zum Ändern antippen. |
| `respond.closed` | Closed: no more answers. | Geschlossen: keine weiteren Antworten. |
| `respond.right` | Right! | Richtig! |
| `respond.wrong` | Not quite. The right answer: {answer} | Leider nicht. Richtig ist: {answer} |
| `respond.solution` | The right answer: {answer} | Richtig ist: {answer} |
| `numeric.placeholder` | A number | Eine Zahl |
| `numeric.invalid` | Enter a number, such as 0.5 or 1/2. | Eine Zahl eingeben, z. B. 0,5 oder 1/2. |
| `numeric.sent` | Sent: {value}. Send another to change. | Gesendet: {value}. Zum Ändern eine andere senden. |
| `numeric.other` | Other | Andere |
| `numeric.right` | {n} right | {n} richtig |

---

## Speaker notes

Use a `:::notes` fenced block in the slide body. Notes support Markdown and are only visible in the presenter view:

```markdown
---
layout: focus
eyebrow: Key point
---
# The main idea.

:::notes
This is the central design decision. Pause here.

- **Content** is readable without tooling
- **Design** is just a CSS file
- Ask: *"what breaks if you swap the theme?"*
:::
```

The `:::notes` block can appear anywhere in the body, but placing it last keeps it visually separate from slide content.

---

## Columns

Place content side by side using `:::columns` with `+++` as the column separator:

```markdown
:::columns

Left column content here.

+++

Right column content here.

+++

A third column, if needed.

:::
```

Each column is an equal-width flex child, so three `+++` separators give four equal columns. Use `:::columns` inside any layout that has a body area — `GenericSlide`, `focus`, etc.

---

## Images

Reference images with standard Markdown syntax or the `image:` frontmatter field. Paths are relative to the deck file.

```markdown
![Alt text](./img/diagram.png)
```

A paragraph of nothing but pictures fits into the room the slide has left: a
large picture shrinks, keeping its proportions, and a small one keeps its
size. Several pictures in one paragraph sit side by side:

```markdown
# Three mornings

![Fjord](./img/fjord.jpg) ![Mountains](./img/mountains.jpg) ![Snow](./img/snow.jpg)
```

A picture inside a sentence stays in the sentence. Themes may set picture
paragraphs their own way (Lightbox fills a grid edge to edge).

A local SVG whose source contains `var(--…)` is drawn inline instead of as an
`<img>`, both in slide text (`![…](./img/drawing.svg)` or `<img src>`) and as a
layout's `image` (`title`, `chapter`, `image-text`, `full-bleed-image`, and
local layouts that render it with `Picture` from `mdeck/layout`). It can use the
palette's custom properties (`--bg`, `--surface`, `--ink`, `--ink-soft`,
`--muted`, `--rule`, `--accent`, `--accent-2`, `--accent-3`, `--on-accent`) and follows the
theme, palette and appearance. Give each a fallback (`var(--accent, #1f3fd1)`)
for places that show the file on its own, set `fit: contain` to keep the whole
drawing, prefix class names in its `<style>` because inline styles apply to the
page, and avoid `id`s, since a slide can be shown more than once. Such SVGs stay
files in single-file builds and travel inside the deck's code instead.

A normal build copies referenced local images, video, and audio next to the HTML
while preserving their deck-relative paths. This is the recommended distribution
format for decks containing substantial video.

To embed all local images and media in a single offline-ready HTML file, use:

```bash
mdeck build slides.md --single-file -o slides.html
```

The theme's web fonts are embedded too (Latin character sets), so the file and
its PDF look like the slides on the presenter's screen, offline as well. They are
fetched once and kept in a cache (`~/.cache/mdeck/fonts`, or `MDECK_CACHE_DIR`);
without network and cache the build uses the fallback fonts and says so.
Self-contained video is base64-encoded and is therefore roughly 33% larger than
the source file; loading, memory use, and seeking can also be worse than with a
separate media file.

To add target-computer launchers to a directory bundle, build with
`--launchers`. The generated `present.sh` (macOS/Linux),
`present.bat`, and `present.ps1` (Windows) require Python 3, start a local server
bound to `127.0.0.1`, and open the presenter view in the default browser.

---

## Video

Embed video with the `<videoplayer>` component. It accepts local files and web video URLs.

```markdown
<!-- Local file — click to play (default) -->
<videoplayer src="./demo.mp4" />

<!-- Autoplay when slide becomes active (muted, as required by browsers) -->
<videoplayer src="./demo.mp4" play="auto" />

<!-- YouTube, Vimeo, or SwitchTube URL -->
<videoplayer url="https://youtu.be/dQw4w9WgXcQ" />
<videoplayer url="https://tube.switch.ch/videos/abc123" play="auto" />
```

| Attribute | Default | Description |
|---|---|---|
| `src` | — | Path to a local video file |
| `url` | — | Web video URL (YouTube, Vimeo, SwitchTube, or direct embed URL) |
| `play` | `click` | `click` — user controls playback; `auto` — plays when slide activates, pauses when leaving |
| `aspect` | `16/9` | CSS `aspect-ratio` value, e.g. `4/3` |
| `muted` | — | Mute the video (always muted in `auto` mode) |

For `play="auto"` the video pauses and resets to the beginning when you navigate away. Local videos also pause automatically on slide leave in `click` mode to avoid unexpected audio.

---

## Polls

`<poll>` asks the audience a question they answer on their phones:

```markdown
# Where do we eat?

<poll room="lunch" options="Mensa|Thai|Pizza|Salad" />
```

| Attribute | Default | Description |
|---|---|---|
| `room` | `poll` | Name of the room that collects the answers; unique per poll in a deck. Letters, digits, `.`, `-`, `_` |
| `options` | — | Answers separated by `\|`. Markdown and `$…$` maths, as on a slide (see below). Or a list inside the tag |
| `question` | — | Question text, Markdown and maths like `options`; phones fall back to the slide heading |
| `qr` | `true` | `false` leaves out the QR code (shown earlier with `<qrcode join />`) |
| `answer` | — | The right answer (several separated by `\|`): a button with a tick outlines its label, bar and count in green, also in the audience window and on paired devices, and each phone says whether its vote was right. `--poll-correct` sets the colour |
| `multiple` | — | Each phone may pick several options; the slide and the phones say so. A vote is then the list of options picked, and is right when it is exactly the `answer` options |
| `buttons` | — | `letters` puts A, B, C … before the options, and the phones show only those; `numbers` does the same with 1, 2, 3 …. For options better read on the slide, such as pictures (`options="![](a.svg)\|![](b.svg)"`) |
| `results` | — | `hidden` starts with the results hidden, e.g. for peer instruction. A button with an eye shows or hides them (bars and counts) at any time, also in the audience window and on paired devices. Hidden, the audience window shows no bars; the presenter's own screens show them faint |

Four more activities take the same `room`, `question` and `qr`:

| Tag | Attributes | Phones | Slide |
|---|---|---|---|
| `<scale>` | `min` (1), `max` (5), `low`, `high` | One button per number, `low`/`high` as labels | Count per number and the average; latest answer per device |
| `<numeric>` | `answer`, `tolerance` (0), `limit` (6), `placeholder`, `results` | A number field: `0.5`, `0,5`, `1/2`, `1e-3`; latest answer per device | The most frequent answers as bars, the rest as Other; with `answer`, the tick marks the right ones, counts them and tells each phone |
| `<wordcloud>` | `placeholder`, `limit` (60), `height` (520) | Text field, up to 40 characters, repeatable | A packed word cloud (d3-cloud): size by frequency, some words upright, case-insensitive |
| `<question>` | `placeholder`, `limit` (8) | Text field, up to 200 characters, repeatable | The newest answers as cards |

`<qrcode follow />` shows the link for following the slides on phones and laptops (`?view=follow`), with `mdeck run --network` or a hosted deck with a `server` setting; the phones' answer page links to it as well. `<qrcode join />` shows the deck's join code large with its link (`size`, default 420), for a slide that invites everyone once; activities after it can use `qr="false"`. QR codes (`<qrcode>`, activities) are SVG in the slide's `--ink` on a transparent background; `--qr-ink` and `--qr-bg` override the colours.

Options and the question may use Markdown and maths, e.g. `options="$2x$|$x^2$|$\frac{x^3}{3}$"`. A `|` inside a formula, `code`, a link or a picture belongs to it (`$|x|$` is one option), and `\|` is a bar in plain text.

For options that are more than a word, write them as a list inside the tag instead of `options`, one item each; `[x]` marks a right answer, in place of `answer`:

```markdown
<poll room="derivative" question="What is $\frac{d}{dx}\, x^2$?">

- [x] $2x$
- [ ] $x^2$
- [ ] $\frac{x^3}{3}$

</poll>
```

Each item is an option as written, with no `|` to split and nothing to escape; an item over several lines is one option. Plain `-` or `1.` items work too, with `answer` or without a right answer. The tag must hold nothing but the list; otherwise it is left as it is. The slide draws maths with KaTeX, the phones as MathML; votes and `answer` use the text as written. The other activities' `question`, and the scale's `low` and `high`, take Markdown and maths too.

The slide shows live bars, the number of answers, a QR code and a short link. Phones never load the deck: they open the server's own answer page at `<server>/<code>`, where the six-digit session code is the same for every poll in the deck. The presenter's screen (the presenter view or a full deck window, never an embedded preview) announces the poll on the current slide with what the phones should show and the deck's look; the server only accepts that from the presenter. Between polls the phones wait. Each device's latest vote counts. The presenter can reset the room (hover over the results).

Every activity has a lock button that closes it: answers after that do not count, and the phones say it is closed until it opens again. Polls and `<numeric>` also have the eye that hides or shows the results. Below the results, polls, scales and `<numeric>` count “12 of 31 answered” while phones are connected (people following the slides count as phones). The lock, the eye and the tick reach every screen of the talk, also after a reload: they are kept in the activity room's state on the server, which only the presenter may set, and phones read it there. Reset clears the answers and opens the activity again.

While `mdeck run` runs, the answers are kept beside the deck in `<slides>.results.json`: per activity room, each answer with its time, the phones numbered per room (their ids are not kept), and, once an activity was closed, only the answers that counted. Reset takes a room out of the file; a new, empty server leaves the file alone. Builds, `mdeck send` and `mdeck pdf` show the kept answers where no room server answers (`--no-results` leaves them out), and `mdeck results [slides.md] [-o file.csv]` prints them as CSV: `room,phone,at,answer`, several picks joined by `|`.

`--no-polls` leaves slides with an activity or a join code (`<qrcode join />`) out of `mdeck send`, `mdeck build --reader` and `mdeck pdf`; without it they show as a record of the talk. Saved drawings follow the remaining slides.

`--slide 3,5-7` keeps only these slides in `mdeck send`, `mdeck build` and `mdeck pdf`, numbered by their place in the deck as written. Drawings follow their slides, and `<style>` elements on the slides left out move to the first slide kept, since they style the whole deck.

Rooms run inside `mdeck run` (add `--network` so phones can reach it) or on a server started with `mdeck server`, set in the deck:

```yaml
server: https://rooms.example.org   # your server; phones join at https://rooms.example.org/<code>
session:
  id: talk                          # optional: name the code is derived from, defaults to the title
  code: 482113                      # optional: the code itself
```

A deck's rooms are named `<code>.<room>` on the server, so decks sharing a server stay apart. See the [Ask your audience](../site/content/audience.md) guide for hosting, and [Create interactive content](../site/content/components.md) for writing other activities with `useRoom` and a `phone` description.

---

## Drawings (ink)

Drawings on slides live in `<deck>.drawings.json` beside `<deck>.md` and are part of every view, build and PDF (`--no-drawings` leaves them out). `mdeck run` saves them as they are drawn; the guide [Draw on your slides](../site/content/drawing.md) covers drawing and presenting from an iPad.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "slides": {
    "the-important-part": [
      {"id":"k3f9a2:lq1x0","tool":"pen","color":"#e11d48","size":6,"points":[[412,630,0.52],[598,641,0.61]]}
    ]
  }
}
```

- Keys under `slides` are slide ids. A slide without an `id:` gets one from its heading when it receives its first drawing, written into its settings.
- `points` are `[x, y, pressure]` in the deck's design pixels (`width` × `height`); if the deck's size changes, strokes are scaled. `tool` is `pen` or `highlighter`.
- Drawings belong to a slide, not to a step of it.
- `mdeck check` reports a broken drawings file and drawings for slide ids that are not in the deck.
- Keys: `D` draw, `I` hide or show drawings, `F` full screen, `Delete` removes the selected strokes.
- The laser pointer and selections are never saved; moving strokes saves them in their new place, with the same ids.

## Deck-local components

Components registered in `src/runtime/registry.jsx` are part of *every* deck. When a
widget is only needed by one talk, put it in a `components/` folder next to the
deck file instead:

```
my-talk/
  my-talk.md
  components/
    Tokenizer.jsx
```

Each `*.jsx` file's default export is registered automatically under its
lowercased filename, so `Tokenizer.jsx` becomes `<tokenizer>`:

```markdown
<tokenizer text="Donaudampfschifffahrt" />
```

Attributes arrive as props, exactly like built-in components. Deck-local
components override a built-in of the same name.

To reuse components across decks, list their folders in the deck settings:

```yaml
components:
  - ../shared-components
  - ~/mdeck-components
```

The deck's own `components/` folder is searched first, then the listed folders
in order, then the built-ins. `mdeck check` reports listed folders that do not
exist.

In PDFs, printouts and the reader's Read mode, every slide is shown at once.
There mdeck reveals all steps and places the slide inside an element with the
`data-deck-static` attribute; a component that builds up step by step should
render its finished state inside `[data-deck-static]`, and follow the stage's
`printchange` event for printing started from an open deck. A slide that holds
only a component can be named for the outline with a `title:` setting.

Because they are only pulled in by the deck that ships them, a heavy dependency
stays out of every other deck's bundle. Install such dependencies in a
`node_modules` next to the deck, or in the framework itself.

> Deck components are `.jsx` only, and are written against Preact — import
> hooks from `preact/hooks`. The build resolves those imports back to the
> framework's own Preact, so the deck folder needs no Preact install.

---

## Inline HTML

You can write HTML directly in slide bodies. It inherits the theme's body text styles automatically. Use it for structural layouts the framework doesn't provide out of the box:

```markdown
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 48px;">
  <div>Left column content</div>
  <div>Right column content</div>
</div>
```
