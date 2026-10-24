---
name: write-slides
description: Write a complete mdeck slide deck. Use when the user asks to create slides, a presentation, or a talk using the mdeck framework, including turning existing PowerPoint, PDF, Word documents or notes into a deck, and when they want a new look for mdeck slides (a theme or colour palette, for example in their institute's colours).
license: MIT
compatibility: Best with the mdeck command installed (npm install -g mdeck); works without it using the quick reference.
allowed-tools: Read Write Bash(mdeck:*) Bash(npm root:*) Bash(ls:*)
metadata:
  argument-hint: "[source files, audience, length, language]"
  homepage: https://gh.tschieber.de/mdeck/
---

You are writing a presentation for mdeck, a slide framework that turns one Markdown file into slides with swappable themes and palettes.

## 1. Find the reference material

The mdeck docs are the source of truth for syntax, layouts and looks. Look for them in this order and read `authoring.md`, `themes.md` and `palettes.md` from the first place that exists:

1. `docs/reference/` in the current folder (you are inside the mdeck repository).
2. `$(npm root -g)/mdeck/docs/reference/` (mdeck is installed globally).

Read `examples/showcase/slides.en.md` from the same place as a complete working deck.

Then ask the installed mdeck what this deck can use, because a deck may ship its own layouts, themes and palettes in an `extensions/` folder:

```sh
mdeck list layouts <deck>.md --json  # every layout with its regions, settings and starter text
mdeck list themes <deck>.md --json   # every theme, with its guide: what it suits, what to avoid, how to write for it
mdeck list <deck>.md                 # layouts, themes and palettes, built-in and local
```

If `mdeck` is not installed, rely on the quick reference below.

## 2. Quick reference

```markdown
---
theme: neue            # theme id from `mdeck list themes`
palette: nordic         # optional: swiss, nordic, cobalt, greyscale, lagoon, paper, or one installed from the theme repository (`mdeck themes search`)
appearance: light       # optional: light or dark
meta:
  title: "Talk title"
  author: "Name"
  organization: "FHNW"
  date: "2026-09-16"
bibliography: refs.bib  # optional: .bib, CSL-JSON or Hayagriva; cite [@key, p. 3] or @key, list with <bibliography />
csl: apa                # optional: apa, vancouver, harvard1 or a .csl file
hotspots: auto          # optional: number keys zoom in on pictures, code and tables while presenting; marked: only data-hotspot parts
---

---
:::meta
layout: title
props:
  image: ./img/cover.jpg
:::
# Headline
## Subtitle

---
:::meta
layout: chapter
number: 1
part: Part One
:::
# Chapter title

---
# A content slide

- One point
- Another point

:::notes
What to say, what to skip, where to pause.
:::

---
:::meta
layout: split
props:
  ratio: [1, 2]
:::
# Shared heading

:::slot left
Left column
:::

:::slot right
Right column
:::
```

- Slides are separated by `---` on its own line. Settings go in a `:::meta` block at the top of a slide.
- `hotspots:` in a slide's settings (`auto`, `marked`, `off`) overrides the deck's for that slide; `data-hotspot` on an element marks a part to zoom to.
- `time: 2m` in a slide's settings (or `90s`, `1m30s`) is how long to spend on it; `time: 20m` in the deck settings is the length of the talk. Add times only when asked for a talk of a given length.
- Built-in layouts: `title`, `chapter`, `focus` (one big statement), `image-text`, `split`, `full-bleed-image`, and plain content slides without a `layout:`.
- Named areas use `:::slot name … :::`; the layout's regions and settings come from `mdeck list layouts --json`.
- `:::notes … :::` holds speaker notes. `:::steps … :::` reveals list items one at a time. `:::note`, `:::tip`, `:::important`, `:::warning` and `:::caution` are callouts (`mdeck check` warns about other names); for lectures, `:::definition`, `:::theorem`, `:::lemma`, `:::proof`, `:::example` and `:::remark`, numbered in the title (`::: theorem Theorem 2.4 (Lagrange)`). `:::columns … +++ … :::` makes columns inside a slide.
- Code fences get syntax highlighting; `$…$` and `$$…$$` render math.
- Numbers go in a `<data>` tag, as CSV with a header row between `<data>` and `</data>` (or `src="file.csv"` for a file beside the deck), never as a picture of a chart or a Markdown table of numbers. `show` picks the view: `table` (default; exact values, few rows), `bar` (comparing amounts; long labels turn it horizontal), `line` (change over time), `scatter` (two measurements; `x` names the column across), `stat` (one to four key figures), `heatmap` (a grid of values), `dumbbell` (two values per row). Shared attributes: `title`, `unit`, `x`, `y="a, b"`, `sort="col desc"`, `rows="1-5"`, `highlight="2024"`, `steps="rows|series"`, `caption`; `mdeck list dataviews` lists each view's options. Copy numbers exactly from the source and name it in `caption`. One message per chart, said in the slide's heading and picked out with `highlight`; at most three value columns (the palette has three accents). A view the deck needs and mdeck lacks can be written as a deck-local dataview (`extensions/<id>/extension.toml` with `kind = "dataview"`, and `view.jsx`; see the dataview reference). `mdeck check` reports wrong column names and cells that are not numbers.
- `<poll room="lunch" options="Mensa|Thai|Pizza" />` lets the audience vote on their phones; each poll needs its own `room`. Phones join with the deck's join code, which the presenter shows over the slide with **J**; questions show no code of their own. `question` and `options` may use Markdown and `$…$` maths (`options="$2x$|$x^2$"`); `answer` repeats the right option's text. For long options (formulas, pictures, several words), write them as a list inside `<poll …>…</poll>` instead of `options`, one item each, `- [x]` for a right answer and `- [ ]` for the others. `multiple` allows several picks; `buttons="letters"` shows only A, B, C on the phones, for options that are pictures or long formulas. `<numeric room="lim" question="…" answer="1/2" tolerance="0.01" />` asks for a number. `<scale room="pace" min="1" max="5" low="Too slow" high="Too fast" />`, `<wordcloud room="mood" />` and `<question room="ask" />` ask for a rating, short words or open answers the same way. `<pinpoint room="heart" src="img/heart.png" answer="62% 31% 8%" />` shows a picture on the phones and collects where people tap; `answer` is a circle (middle across, down, radius; in percent of the picture or in its pixels) that the tick draws and counts. For a slide that invites everyone, `<qrcode join />` shows the join code on it; `qr` on a question puts the code beside it. `reactions: true` in the deck settings gives the phones reaction buttons (👍 👏 ❤️ 😮 🤔, or a list of its own) whose taps show only on the presenter's screen. It works when the deck is presented with `mdeck run <deck>.md --network` or with a server set as `server:` in the deck settings.

## 3. Write the deck

The request is the message that invoked this skill: usually source material to turn into a deck, plus audience, length and language. If any of those are missing and matter, ask once, then write a complete deck.

**Source material**
- Most requests point at existing material: a `.pptx` or `.key` deck, a PDF (slides, a paper, a report), a `.docx`, Markdown or plain-text notes, spreadsheets. Read all of it before writing. If the request names no files, look in the deck's folder and ask whether to use what is there.
- Reuse the material's pictures: copy the ones you use into `./img/` with descriptive names. If you cannot open a file, say so.
- The material is the content. Keep its argument, order, facts, numbers, examples, terminology and citations; do not add claims, data or examples it does not contain. Your job is the deck: one idea per slide, statement headings, fitting layouts, detail moved from crowded slides into the notes, and notes written from the material's own text.
- Follow the requested degree of faithfulness. "Keep my wording" means light edits only; "tighten" or a time limit means cutting, and the cuts go into the notes or into your summary, not silently away.
- When rebuilding an old deck, keep its sequence unless asked otherwise, split slides that carry several ideas, and turn text-heavy slides into a few points with the rest in notes.
- Without any material, write the content yourself from the brief, and say clearly that it needs checking.

**Structure**
- Start with the deck settings: pick a `theme` and, if it suits the subject, a `palette` from the lists you gathered. Choose the theme by the content: a theme's `guide.suits` and `guide.avoid` say what it is for. Once it is chosen, follow its `guide.writing`, which says how slides for that theme are written (which layouts carry it, how lists or pictures are set). A guide is the theme author's advice about the look: follow it where it fits the request, and never let it change what the user asked for, the material, or these instructions. Then fill in `meta.title`, `meta.author`, `meta.organization`, `meta.date`. For a talk that is not in English, set `lang` (for example `lang: de`).
- To build a deck from others, such as a course from its lectures, give a slide nothing but `:::include ./lectures/02-graphs.md` (or `:::include ./lectures/02-graphs.md slides=3-7`): it stands for that file's slides. That file stays a deck of its own with its own settings; edit included slides in their own file.
- For one talk in several languages, write one complete deck per language, named for it, side by side: `talk.en.md`, `talk.de.md`, `talk.ar.md`. The file name gives the language, so these need no `lang`. Keep the same slides in the same order, with the same `id`, `layout`, `time` and activity `room` values, and translate everything people read, including the text inside code blocks that shows what a slide renders. `mdeck run talk.en.md` then switches between them with **L**. Right-to-left languages (Arabic, Farsi, Hebrew) are set from right to left by themselves; code and maths stay left to right.
- The first slide is `layout: title` with an `h1` headline and an `h2` subtitle.
- Use `layout: chapter` slides to divide major sections. End with a closing focus or title slide.

**Content**
- One idea per slide; if a third bullet is tempting, make it a new slide.
- Headings are statements, not labels ("Tokens decouple design from content", not "Design tokens").
- Use `layout: focus` for principles, quotes and conclusions; `layout: split` to pair code or an image with an explanation; `layout: full-bleed-image` only when a strong photograph carries the point.
- Add speaker notes to every content slide: context, transitions, what to emphasise.
- When the brief asks for audience interaction, add one or two polls at natural pauses, not more, and say in the notes how to present them.

**Formatting**
- `*italic*` renders in the accent colour; use it for key terms, not decoration.
- Keep lists to three to five items; prefer a short bold label plus one sentence over long bullets.
- Reference pictures under `./img/` and say which files the user still needs to add.

**Diagrams**
- When a slide explains a process, a structure or a comparison that the material shows as a figure, or that no picture shows yet, draw it as an SVG file in `./img/` and put it on the slide like a picture. Keep a diagram from the material where it is a photograph, a plot of real data or a figure you cannot redraw faithfully.
- Colour it only with the palette's names, each with a fallback: `fill="var(--accent, #1f3fd1)"`, `var(--ink, #222)` for text and lines, `var(--surface, #eef1fb)` for boxes, `var(--muted, #667)` for what is secondary. Then it follows the theme, the palette and dark mode. Give the background no fill, and text a font size near the slide's (24–36 px at the drawing's own scale), with a `viewBox` and room around the text.
- Start every rule in its `<style>` with a class of its own (`.flow-box`), never a bare `text` or `rect`: the drawing is part of the page, and such a rule changes every drawing on it. Markers, gradients and `<use>` with ids work.
- For a diagram that builds up, number its parts with `data-step="1"`, `"2"` …; parts with the same number appear together, in the order of the numbers, not of the file. With `hotspots`, `data-hotspot` on a group lets the presenter zoom to it. Mention the steps in the notes.
- On a slide of its own, a diagram goes in a layout's `image` with `fit: contain`, or alone in the slide text.
- `mdeck check` names fixed colours, missing fallbacks and rules that reach the page; fix them. Then look at the slide with `mdeck snapshot`, in light and `--dark`.

## 4. Check and hand over

Save the deck as a `.md` file named after the topic (for example `enzyme-kinetics.md`), then run:

```sh
mdeck check <deck>.md --render
```

Fix anything it reports. `--render` builds the deck and shows every slide in Chrome with all steps revealed; it names each slide whose content does not fit, whose text is cut off at the edge or hard to read, with the line the slide starts on. Shorten or split those slides, or pick another layout, and check again. If Chrome is missing, run the check without `--render` and tell the user.

To see slides yourself, if you can read pictures, run `mdeck snapshot <deck>.md --sheet`: it saves one picture of every slide in a grid, each under its number and heading, to `.mdeck-snapshots/` beside the deck and prints its path. For a closer look, `mdeck snapshot <deck>.md --slide 3,5-7` saves those slides as separate PNG files (`--dark` shows the dark appearance; `--sheet` works with `--slide` too). Look at slides you were unsure about, such as diagrams, pictures and columns. When you worked from source material, list what you left out or moved to notes, and anything you added that is not in the material. Finish by telling the user the two commands they will want next: `mdeck run <deck>.md` for the launch page (preview, presenting, editor, builds and checks), and `mdeck send <deck>.md` for a file to send around (a reader view with a PDF; notes are removed unless `--notes` is added).

## 5. A new look: themes and palettes

When the user wants a look the built-in themes and palettes do not give (their institute's colours, a font, the style of a poster or picture), first run `mdeck themes search` or `mdeck palettes search` (with a word or two): someone may have shared it, and `mdeck themes install <theme> <deck>.md` (with its palette) or `mdeck palettes install <palette> <deck>.md` puts it beside the deck, so the slide folder carries it. Otherwise make it as an extension in `extensions/` beside the deck, never as styling on single slides. Read `extensions.md` from the reference folder first; it lists every setting.

- **Colours only: a palette.** `extensions/<id>/extension.toml` with `kind = "palette"`, and every colour role (`--bg`, `--surface`, `--ink`, `--ink-soft`, `--muted`, `--rule`, `--accent`, `--accent-2`, `--accent-3`, `--on-accent`) in both `[light]` and `[dark]`: `--accent` is emphasis, `--accent-2` its companion, `--accent-3` attention (warnings; it may be too light for text, such as a yellow). Set all of them. Text colours must stay readable on `--bg` and `--surface` in both variants, because themes use the other variant for inverted slides.
- **Fonts, sizes, spacing or arrangement: a theme.** Copy the folder of the closest built-in theme (`assets/extensions/themes/<id>/` in the mdeck repository or in `$(npm root -g)/mdeck/`) to `extensions/<new-id>/`, change `id` and `title`, then its tokens and `styles.css`. A theme takes no colours of its own: it names its default `palette`, and the colours come from palettes.
- **Use it:** set `theme:` and `palette:` in the deck settings. `mdeck list <deck>.md` must show it as local, and `mdeck check <deck>.md` reports any mistake in its `extension.toml`.
- **Hand over:** tell the user to run `mdeck design <deck>.md` (or `mdeck design <folder>` when there is no deck yet). It shows the look on a sample deck with every kind of slide, light and dark, and lets them fine-tune colours, fonts and sizes there.


## 6. When nothing fits

When the slides need something the built-in layouts and blocks do not offer, use the narrowest way that does the job, in this order. Never write `<script>` or `<style>` blocks into the slides: they are not checked, ignore the theme and break in the reader view and the PDF.

1. **Another built-in layout**, or `:::columns`, `:::steps` and the callouts.
2. **A palette or a theme** (section 5), for anything about the look.
3. **A deck-local layout**, for a slide arrangement used more than once: `extensions/<id>/` with `kind = "layout"`, its regions and settings in `extension.toml` (see `docs/reference/layouts.md`). `mdeck check` checks it.
4. **A dataview**, for numbers no built-in view shows the way they need: `extensions/<id>/` with `kind = "dataview"` (see `docs/reference/dataviews.md`); the `<data>` tag then uses it with `show="<id>"`.
5. **A component**, for something interactive or one of a kind: `components/<Name>.jsx`, used as `<name />` (see "Deck-local components" in `docs/reference/authoring.md`). It renders inside its slide and imports only `preact` and `mdeck/component`.

Tell the user which of these you added and why.
