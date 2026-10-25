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
| `meta.logo` | — | Path to logo image (shown on the title slide, and on every slide with `show.organization: all`; inverted on dark slides unless `meta.logo-dark` is set or the palette sets `--logo-filter`) |
| `meta.logo-dark` | — | A second logo for dark slides, shown as it is instead of the inverted `meta.logo` |
| `width` / `height` | `1920` / `1080` | Slide canvas dimensions in px |
| `show.organization` | `title` | When to show the organization name and logo: `title`, `all`, or `none` (the logo stays on the title slide) |
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
| `params` | — | The theme's own settings, such as its fonts (see below) |
| `reader.themes` | `true` | Whether the reader view offers a switch between light and dark (see below) |
| `reader.notes` | `false` | Whether the reader view shows speaker notes under each slide in Read mode |
| `bibliography` | — | Reference file, or a list of them, relative to the deck: `.bib`, `.json` (CSL-JSON) or `.yml` (Hayagriva) (see [Citations](#citations-and-references)) |
| `csl` | `apa` | Citation style: `apa`, `vancouver`, `harvard1`, or a `.csl` file |
| `nocite` | — | References to list without citing them; `['*']` lists the whole file |
| `show.citations` | `true` | `false` leaves out each slide's own references above the footer |
| `time` | — | How long the talk takes, such as `20m`: slides without their own `time` share what is left (see [Time your talk](../site/content/presenting.md#time-your-talk)) |
| `hotspots` | `off` | Number keys zoom in on parts of a slide while presenting: `auto` (pictures, code, tables, formulas, videos, callouts, columns, polls and `data-hotspot` elements), `marked` (only `data-hotspot` elements) or `off` (the number keys do nothing) |
| `reactions` | — | Reaction buttons on the phones' answer page; a tap floats up on the presenter's screen only, and is not kept: `true` (👍 👏 ❤️ 😮 🤔) or a list of 1 to 8 emoji or words of up to 16 characters |

### Theme params

Themes offer settings of their own: their fonts, and often the size or
strength of what makes them look the way they do. Set them under `params:`:

```yaml
params:
  fontDisplay: "Georgia, serif"
  glassBlur: 12px
```

Available params depend on the theme; `mdeck list themes` shows them with the
kind of value each takes: a size in pixels, a number, a switch (`1` or `0`), a
choice, a font or a text, written as it should appear (`prompt: "~/demo $ "`). `0` or `0px` turns a feature off.
A font named this way is not downloaded: it has to be installed on the
computer that shows the slides, or the browser uses the next font in the
list; PDFs and single files embed only the theme's own fonts. A value that does not fit
is left out, and `mdeck check` says why. Colours are not params: they come from
the palette.

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

## Including other decks

A slide that is nothing but an `:::include` line, with no settings, stands for the slides of another deck file:

```markdown
---
:::include ./lectures/02-graphs.md
---
:::include ./lectures/02-graphs.md slides=3-7
---
:::include "./lectures/week 3.md"
```

- The included file is a complete deck and can be presented alone; a file of slides without deck settings can be included too. When it is included, its slides come along with what they need from its settings, and the look stays the including deck's:
  - `hotspots` and `time` become each included slide's own, unless it has one. A slide without a time gets its share of the included deck's `time`, shared out as that deck does alone (its slides' own times first, the rest in equal parts); `slides=` keeps each chosen slide's share.
  - `bibliography` files and `nocite` keys are added to the including deck's; `csl` too, when the including deck sets none. Its `<bibliography />` lists the works it cites itself (and its `nocite`), not every work of the including deck.
  - `components` folders, and a `components/` folder beside the included file, are added to the including deck's.
  - Callout names of its own under `callouts` are added, unless the including deck names them; titles it gives built-in callouts are not.
  - `theme`, `palette`, `appearance`, `params`, `width`, `height`, `lang`, `labels`, `show`, `meta`, `reader`, `server` and `session` are ignored, and a problem with them is not reported for the including deck.
- A block at the top of an included file with only `time:` or `hotspots:` (keys both a deck and a slide have) is read as the file's settings, for all its slides; `mdeck check` says so. For the first slide alone, write them in a `:::meta` block.
- `slides=` keeps the slides with these numbers (`3`, `3,5`, `2-4`), counted as the included file shows them, like `--slide`.
- Local paths (Markdown pictures, `<img>`, `<video>`, `<videoplayer>` and `<audio>` sources, `image:` and `logo:`) are read from the included file's folder. Paths from the root (`/…`) stay as written.
- Includes may nest. A file that includes itself, directly or through others, is an error, as is a missing file or a slide number beyond the file.
- In a deck whose file name gives a language (`course.de.md`), `./part.md` is read as `./part.de.md` when that file exists.
- Ids: slides of the including deck keep the ids they have in it; included slides get the included file's name in front of theirs, without leading digits (`02-graphs.md` → `graphs-slide-3`, `graphs-dijkstra`), with `-2`, `-3` … when the same name comes up again. Drawings made while presenting are saved under these ids, in the including deck's drawings file.
- Saved rehearsal times go into the file the slide is written in. The editor (`mdeck edit`) shows an include as one card; edit included slides in their own file.
- Palettes, layouts and themes are found beside the including deck.

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
| `hotspots` | This slide's own hotspots: `auto`, `marked`, `off` or `false` (see the deck field) |
| `time` | How long to spend on the slide: `90s`, `2m`, `1m30s`, `1.5m` or `1h30`. The presenter view counts it down; `mdeck rehearse` measures and saves it |

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
- **`<bibliography />`** lists every cited work, plus those named in `nocite`, in the style's order. A list too long for one slide goes on several: `<bibliography part="1/2" />` on one and `<bibliography part="2/2" />` on the next split it in halves. `<bibliography keys="smith2020 doe2019" />` lists only these works. In a deck that includes others, an included deck's `<bibliography />` lists the works that deck cites, as it does when shown alone, and the including deck's own lists every work.
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

For numbers, a `<data>` tag is easier to keep and can also be a chart (next section).

---

## Data: tables and charts

`<data>` holds a table of data as CSV, between its tags or in a file beside
the deck, and a *dataview* shows it: a table unless `show` names another.

```markdown
<data show="bar" title="Yield per hectare" unit="t" highlight="2024">
year, wheat, barley
2022, 7.1, 5.9
2023, 6.4, 6.2
2024, 7.8, 6.0
</data>

<data src="data/yields.csv" show="line" />
```

The first row names the columns. Cells are separated by commas, semicolons or
tabs (the first row decides); a cell with a separator, a quote or a line break
is written in double quotes, a quote in it doubled. Numbers use a decimal
point or a decimal comma (`7.1` or `7,1`; in a file separated by commas, a
number with a comma is quoted: `"7,1"`) and no thousands separators: `1,234`
is one point two three four. `12 %` is a percentage, `2024-03` a date. Numbers
are shown as the deck's `lang` writes them. A column is of numbers when
every filled cell is one; an empty cell is no value. The first column may go
without a name, as the row names of a matrix often do. A file (`src`) is read
from the deck's folder, bundled into builds, and redraws its slides under
`mdeck run` when it changes.

Attributes every dataview reads:

| Attribute | Meaning |
|---|---|
| `src` | A CSV file instead of the text between the tags |
| `show` | The dataview: `table` (default), `bar`, `line`, `scatter`, `stat`, `heatmap`, `dumbbell`, or one of the deck's own |
| `title` | A title above the data |
| `x` | The column that names the rows; default: the first that is not numbers, else the first |
| `y` | The value columns, separated by commas (`y="wheat, barley"`); default: every column of numbers but `x` |
| `rows` | Rows to show, counted after sorting: `1-10`, `1,3,5` |
| `sort` | A column to sort by, with `desc` for largest first: `sort="wheat desc"` |
| `highlight` | Rows to pick out, by their label (or any of their cells): `highlight="2024"`, `highlight="Bern, Zug"` |
| `steps` | Build up: `rows` (one row a press) or `series` (one value column a press), where the dataview can |
| `unit` | The unit of the values, shown in headers and axis titles |
| `height` | The height of a chart in slide pixels (default 520) |
| `caption` | A line under the data, such as its source |

Every other attribute is an option of the dataview (`mdeck list dataviews`
lists them):

| Dataview | Shows | Options |
|---|---|---|
| `table` | The data as the theme draws tables; numbers right, the unit in their headers, highlighted rows marked | `max-rows` (12; the rest are counted), `numbers` (`as-written` or `formatted`) |
| `bar` | Columns from a baseline at 0, bars when the labels are long; several series side by side or `stacked` | `orientation` (`auto`, `vertical`, `horizontal`), `stacked`, `values` (`auto`, `all`, `highlight`, `none`), `max` (the axis ends exactly there; bars beyond are cut off, and `mdeck check` warns), `min` (0 or below: bars start at 0, and `mdeck check` warns of a `min` above it) |
| `line` | One line per series, the last value at its end; numbers or dates in `x` are spaced by their value | `points` (`auto`, `all`, `none`), `fill` (one series), `zero`, `min`, `max` (the axis starts and ends exactly there; lines beyond are cut off) |
| `scatter` | Points: `x` across (a column of numbers or dates), each value column up | `labels` (a column naming the points), `zero` |
| `stat` | One to four figures, large, as the deck's language writes them, each with its row's label | `change` (a column with each figure's change) |
| `heatmap` | A grid coloured by value; values either side of 0 in two colours | `values`, `scale` (`auto`, `sequential`, `diverging`), `min`, `max` |
| `dumbbell` | Two values per row joined by a line | `values`, `zero` |

A switch (`stacked`, `fill`, `zero`, `values`) is on when written without a
value or as `true`. Series take the palette's accents in order (`--accent`,
`--accent-2`, `--accent-3`), then mixes of them with the ink; numbers are
written as the deck's `lang` writes them. Charts carry a table of their data
for screen readers. `mdeck check` reports a missing file, columns the data
does not have, cells that are not numbers, properties a dataview does not take,
data it cannot show, and more value columns than the palette has accents.

A deck can add its own dataview as an extension (`kind = "dataview"`); see
[the dataview guide](dataviews.md).

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

`lang` is the language of the whole deck. The page is marked with it, so screen readers pronounce the slides correctly and browsers hyphenate them. It also picks the words mdeck itself shows the audience: the reader view's buttons, the deck's control bar, polls on the slide and on phones, and callout titles. English (`en`), German (`de`) and Arabic (`ar`) are built in; for any other language the words stay English. A regional code such as `de-CH` uses the German words.

The presenter view, the launch page and the editor are tools for the author and always stay English.

### One talk in several languages

Write the talk once per language, in files named for it, side by side: `talk.en.md`, `talk.de.md`, `talk.hi.md` and so on. The language is a two-letter code after the name, with a region if needed (`talk.de-CH.md`). A file named this way needs no `lang`: its name gives it.

`mdeck run talk.en.md` finds the other files with the same name and adds a **Language** switch to the presenter view (**L** goes to the next language). Switching changes the slides, your notes and mdeck's own words in every window: the audience window, a paired iPad and the phones following the talk. Your place stays, as do the step on the slide, the drawings and the poll results: slides match by their place in the deck, so keep the same slides in the same order in every language. A deck in one language shows no switch.

A language written from right to left, such as Farsi (`fa`), Arabic or Hebrew, sets its slides and your notes from right to left: the text, lists, quotations, tables and the place of the header and the page number. Code and maths stay left to right, as do mdeck's own controls.

Each file is a complete deck: `mdeck check`, `mdeck edit` and `mdeck send` work on one language at a time, and drawings and results are kept beside the file you run.

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
| `pinpoint.inside` | {n} of {of} on target | {n} von {of} im Ziel |
| `pinpoint.pick` | Tap the spot. | Auf die Stelle tippen. |
| `pinpoint.confirm` | Move the pin if needed, then send. | Pin bei Bedarf verschieben, dann senden. |
| `pinpoint.sent` | Sent. Tap elsewhere and send again to change. | Gesendet. Zum Ändern woanders tippen und erneut senden. |
| `pinpoint.loading` | Loading the picture… | Bild wird geladen… |
| `pinpoint.wrong` | Not quite: the circle shows the right spot. | Leider nicht: Der Kreis zeigt die richtige Stelle. |
| `pinpoint.solution` | The circle shows the right spot. | Der Kreis zeigt die richtige Stelle. |

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
drawing, and start every rule in its `<style>` with a class of the drawing's
own (`.flow-box`), because inline styles apply to the page. Each copy in the
page gets ids of its own, and `url(#…)` and `href="#…"` inside it follow them,
so markers, gradients and `<use>` work on every slide that shows the drawing;
`#id` selectors in its `<style>` do not. Such SVGs stay files in single-file
builds and travel inside the deck's code instead.

Being part of the slide, such a drawing can build up: `data-step` on its parts
reveals them one press at a time. Numbered parts (`data-step="1"`,
`data-step="2"` …) appear in the order of their numbers, and parts with the
same number together, whatever their order in the file, which is also the order
they are drawn in; the drawing's steps come where its first step is in the
slide. Bare `data-step` parts appear in document order. With hotspots on,
`data-hotspot` on a part makes it a hotspot once it is shown.

```svg
<g data-step="1" data-hotspot>…input…</g>
<g data-step="1">…output…</g>
<g data-step="2">…the arrow, drawn under both…</g>
```

`mdeck check` warns about a palette name without a fallback (`svg-fallback`),
fixed colours that do not follow the palette or dark mode (`svg-fixed-colour`),
style rules that reach beyond the drawing (`svg-style`), numbered and bare steps
in one drawing (`svg-steps`), and `data-step` or `data-hotspot` in an SVG that
uses no palette colour, which is shown as a picture and so cannot build up
(`svg-not-inline`).

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
| `qr` | `false` | Puts the join code beside the question; **J** in the presenter view shows it over any slide |
| `answer` | — | The right answer (several separated by `\|`): a button with a tick outlines its label, bar and count in green, also in the audience window and on paired devices, and each phone says whether its vote was right. `--poll-correct` sets the colour |
| `multiple` | — | Each phone may pick several options; the slide and the phones say so. A vote is then the list of options picked, and is right when it is exactly the `answer` options |
| `buttons` | — | `letters` puts A, B, C … before the options, and the phones show only those; `numbers` does the same with 1, 2, 3 …. For options better read on the slide, such as pictures (`options="![](a.svg)\|![](b.svg)"`) |
| `results` | — | `hidden` starts with the results hidden, e.g. for peer instruction. A button with an eye shows or hides them (bars and counts) at any time, also in the audience window and on paired devices. Hidden, the audience window shows no bars; the presenter's own screens show them faint |

Five more activities take the same `room`, `question` and `qr`:

| Tag | Attributes | Phones | Slide |
|---|---|---|---|
| `<scale>` | `min` (1), `max` (5), `low`, `high` | One button per number, `low`/`high` as labels | Count per number and the average; latest answer per device |
| `<numeric>` | `answer`, `tolerance` (0), `limit` (6), `placeholder`, `results` | A number field: `0.5`, `0,5`, `1/2`, `1e-3`; latest answer per device | The most frequent answers as bars, the rest as Other; with `answer`, the tick marks the right ones, counts them and tells each phone |
| `<wordcloud>` | `placeholder`, `limit` (60), `height` (520) | Text field, up to 40 characters; a phone's latest word counts | A packed word cloud (d3-cloud): size by frequency, some words upright, case-insensitive |
| `<question>` | `placeholder`, `limit` (8) | Text field, up to 200 characters, repeatable | The newest answers as cards |
| `<pinpoint>` | `src`, `alt`, `answer`, `height` (520), `results` | The picture; a tap puts a pin, Send sends it as `{ x, y }` (0 to 1 across the picture); latest answer per device | The picture with a dot for each tap. `answer` is a circle, `x y r` in percent of the picture (`62% 31% 8%`, the radius of its width) or in its pixels (`412 230 40`): the tick draws it, colours the dots inside and outside, counts those inside and tells each phone |

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

Phones never load the deck, so a `<pinpoint>`'s picture reaches them through the room server: the presenter's screen draws it at most 1000 pixels wide or high and at most 190 KB, as WebP or JPEG (an SVG too, so no SVG reaches the phones), and sends it to the server, which holds one picture per session, in memory, only while a `<pinpoint>` is on screen. A picture from another site that may not be drawn is linked as it is, if it is on https. A server older than this feature cannot take the picture: update `mdeck server` too. Pixels in `answer` are those of the picture as stored (an SVG's `width` and `height`).

Every activity has a lock button that closes it: answers after that do not count, and the phones say it is closed until it opens again. Polls, `<numeric>` and `<pinpoint>` also have the eye that hides or shows the results. Below the results, polls, scales, `<numeric>` and `<pinpoint>` count “12 of 31 answered” while phones are connected (people following the slides count as phones). The lock, the eye and the tick reach every screen of the talk, also after a reload: they are kept in the activity room's state on the server, which only the presenter may set, and phones read it there. Reset clears the answers and opens the activity again.

While `mdeck run` runs, the answers are kept beside the deck in `<slides>.results.json`: per activity room, each answer with its time, the phones numbered per room (their ids are not kept), and, once an activity was closed, only the answers that counted. Reset takes a room out of the file; a new, empty server leaves the file alone. Builds, `mdeck send` and `mdeck pdf` show the kept answers where no room server answers (`--no-results` leaves them out), and `mdeck results [slides.md] [-o file.csv]` prints them as CSV: `slide,room,kind,question,phone,at,answer`, several picks joined by `|` (`kind` is poll, scale, number, words, question or spot; a room the deck no longer asks has no slide; a tap on a picture reads `62.1% 31.4%`). `--summary` prints `slide,room,kind,question,answer,count,share`: one row per option, scale step, number or word, counted as the slide counts them (each phone's latest answer for polls, scales and numbers; every answer for words and questions), and `average` and `median` rows for scales and numbers; for a `<pinpoint>` with `answer`, `on target` and `off target`. `--json` (or `-o file.json`) writes `{ version, title, exportedAt, questions: [{ room, slide, kind, question, closed, savedAt, summary, answers }] }`. The results file also keeps each activity's right answer as the slide knew it (`solution`); for a `<pinpoint>` that is its circle measured on the picture, which the summary counts with. The launch page offers the same three files.

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

### Shared state across slides and windows

A component can keep a value that every slide and every window of the talk
share: the presenter's slide, the audience window, other deck windows in the
same browser, and a paired iPad. Import it from `mdeck/component`:

```jsx
import { h } from 'preact'
import { useShared, useView } from 'mdeck/component'

export default function Counter() {
  const [count, setCount] = useShared('count', 0)
  return <button onClick={() => setCount(n => n + 1)}>{count}</button>
}
```

- `useShared(name, initial)` returns the value and a function to set it, like
  `useState`. `initial` stands in until a window sets one. Values must survive
  JSON (numbers, text, lists, plain objects). The latest change wins.
- A window opened later, or reloaded, gets the current values from the others.
  Nothing is saved: when every window of the talk is closed, the values are gone.
- `useView()` says which window the component is in: `presenter` (the
  presenter view's slide), `audience`, `deck`, `follow` (a phone following the
  talk), `preview` (the next-slide preview and the editor) or `reader`.
  Previews, followers and the reader see shared values but do not change them.
- Choose names that belong to your component, such as `countdown` or
  `quiz:round`: every component in the deck shares one set of names.

A button the presenter uses during the talk, such as one that starts or stops
something, can be offered in the presenter view's toolbar and on the phone
clicker: give it `data-presenter-control`, an `aria-label` (or a value for
`data-presenter-control`) that says what it does, `aria-pressed` while it is
on, and `data-presenter-icon` with one of mdeck's icon names. A press there
clicks the button on the slide.

```jsx
<button data-presenter-control data-presenter-icon="play" aria-label="Start the countdown"
  aria-pressed={running} onClick={toggle}>…</button>
```

`mdeck/component` and these attributes are the part of mdeck that components
may rely on; they are kept stable across versions. A component renders inside its slide. Anything
else it reaches, such as the page outside its slide, the `<deck-stage>`, mdeck's
events or the presenter view, is not part of it and may change without notice.

---

## Inline HTML

You can write HTML directly in slide bodies. It inherits the theme's body text styles automatically. Use it for structural layouts the framework doesn't provide out of the box:

```markdown
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 48px;">
  <div>Left column content</div>
  <div>Right column content</div>
</div>
```
