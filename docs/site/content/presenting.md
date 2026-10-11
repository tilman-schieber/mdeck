# Add notes and present

The presenter view puts your current slide, the next slide, your notes, and a timer in one place. Your audience can see the slides in a separate window.

## Write notes for yourself

Add a notes block at the end of a slide:

```markdown
# A place to grow

Every neighborhood has a starting point.

:::notes
Welcome everyone. Ask who has visited the garden.

- Pause for answers.
- Keep this introduction short.
:::
```

The words between `:::notes` and `:::` appear in the presenter view, not on the audience slide.

The `write-slides` skill writes notes for every content slide. Make them yours before you present, by hand or by asking:

```prompt
Shorten the notes to cues I can glance at, and mark which slides I
can skip if I run out of time.
```

## Open the presenter view

```sh
mdeck run my-talk.md
```

The launch page it opens has a **Presenter view** button.

Use its audience-window button to open a separate view of the slides. If you have a projector or second screen, move that audience window onto it. Keep the presenter window on your own screen.

The two windows follow the same slide and reveal position: navigate in either window and the other follows. This works between windows in the same browser and between your laptop and a paired iPad. To connect the iPad, see [Draw on your slides](drawing.html#present-from-an-ipad).

A video file you play, pause or move in the presenter view does the same in the audience window, which plays the sound; the presenter view's copy stays silent while the audience window is open. Click the audience window once before the talk, so the browser lets it play sound.

Small icons next to **Speaker View** show what is connected to the deck: presenter views, audience windows and, for decks with polls, how many phones. Point at them to see on which devices, such as "Presenter view on an iPad". The launch page shows the same under **Present**, and marks each view that is open.

For a single screen, switch the presenter view to its slide-only layout. **F** or the fullscreen button fills the screen in either the presenter view or the audience window; fullscreen does not select another view.

To let people answer a question on their phones, put a poll on a slide. See [Ask your audience](audience.html).

## Move through the talk

| Key | What it does |
|---|---|
| Right arrow, Space, or Page Down | Show the next point, then the next slide |
| Left arrow or Page Up | Hide the last revealed point, or return to the previous slide |
| Home | Go to the first slide |
| End | Go to the last slide when the slide view has focus |
| R | Start again and clear the reveals |
| D | Start or stop drawing on the slide ([Draw on your slides](drawing.html)) |
| I | Hide or show the drawings |
| F | Full screen, where the browser allows it |
| N | Open or close the notes drawer, in the presenter view's slide-only layout |
| L | Switch to the talk's next language, for a talk written in several (see below) |
| 1–9 | Zoom in on a part of the slide, with hotspots on (see below); without them, go to slide 1–9 |
| 0 or Escape | Show the whole slide again |
| H | Turn hotspots on or off for this talk, in the presenter view |

Click the slide area if your keys are not controlling it. Keys behave normally while you are typing in a text field.

The timer is for your own reference; you can start, pause, and reset it in the presenter view.

## Zoom in on part of a slide

Hotspots let you show one part of a slide large: a picture, a chart, a code block, a table. Turn them on in the deck's settings:

```markdown
---
hotspots: auto
---
```

The presenter view then puts a small numbered key on each part of the slide you can zoom to. Press its number, or tap the key on an iPad, and the slide zooms smoothly until that part fills the screen. A part of another shape than the screen keeps the slide around it in view. The audience window, a paired iPad and phones following the talk zoom along; only the presenter view shows the keys.

To see the whole slide again, press the same number again, **0** or **Escape**, tap the slide, or use **1:1**. The next point or the next slide shows the whole slide by itself, so you never need an extra key press to move on. Another number while zoomed goes straight to that part.

| Setting | What gets a key |
|---|---|
| `hotspots: auto` | Pictures, code blocks, tables, formulas, videos, callouts, columns and polls, and anything marked `data-hotspot` |
| `hotspots: marked` | Only what you marked with `data-hotspot`; nothing is found by itself |
| `hotspots: off` | Nothing. This is the default: 1–9 go to slides 1–9 |

A slide can have its own setting in its frontmatter, such as `hotspots: false` for a slide whose numbers you do not want, or `hotspots: auto` on one slide of a deck without hotspots. Mark a part of your own in inline HTML with `data-hotspot`, and keep a found one out with `data-hotspot="off"`:

```markdown
The rate is <span data-hotspot>**2.4 %** a year</span>, for now.
```

In a drawing that takes its colours from the theme, `data-hotspot` on a group makes that part of the drawing a hotspot.

Parts that nearly fill the slide, or its whole width, get no key, since there is nothing to zoom; what is inside them may. A part inside another one shares its key: a column with a formula and a tip in it is one part. The keys follow reading order, up to nine on a slide. In the editor, the deck's settings and each slide's details have a **Hotspots** choice too. **H**, or the button beside **Draw**, turns hotspots on or off for the rest of the talk without changing the deck; a slide set to `false` stays without them.

## One talk in several languages

To give a talk in English, German or another language as the room needs, write it once per language, in files side by side named for it:

```text
talk.en.md
talk.de.md
```

Start either with `mdeck run talk.en.md`: the presenter view gets a **Language** switch, and **L** goes to the next language. Switching changes the slides, your notes and the words mdeck shows in every window, including the audience window, a paired iPad and phones following along, and keeps your place, the step on the slide and the drawings. Slides match by their place in the deck, so keep the same slides in the same order in every file. A talk in one language shows no switch.

`mdeck send talk.de.md` makes the German file to hand out; each file is a complete deck of its own.

## Show a countdown to the room

For group work or an exercise, the presenter view has a **Countdown** that the room can see: in the speaker layout below the steering note, in the iPad's slide-only layout behind the ⏱ button.

- Choose its length (1, 3, 5, 10, 15 or 30 minutes, or type a number), then start and pause it; **+1′** adds a minute, the round arrow starts it over.
- The eye shows it in the audience window or hides it again. It keeps running while hidden.
- The arrows put it in a corner, the dot big in the middle of the screen. In its last minute it turns amber, at the end red.

**A sound at the end.** List sound files in the deck's settings (`timer: { sounds: { Gong: ./sounds/gong.mp3 } }`, files beside the deck) and the countdown offers them: choose one, its volume, **Try** to hear it once, **Stop** to end it, for example music for a break. It plays in the audience window when the time is up. Click once into the audience window before the talk: browsers play sound only after that, and the window says **Click for sound** until then.

It follows from any screen of the talk: started on a paired iPad, the audience window and the laptop's presenter view show the same time, and a window opened or reloaded later catches up within a few seconds.

## Reveal points one at a time

Wrap a list in a steps block:

```markdown
# Our plan

:::steps
- Meet the neighbors.
- Choose a first project.
- Set a date.
:::
```

Each press of the next key reveals one point. Once all points are visible, the next press moves to the following slide. Printed slides show all the points. A drawing can build up the same way; see [A drawing that builds up](media.html#a-drawing-that-builds-up).

## Before the talk

- Open the talk on the computer you will use.
- Try the audience window and check the correct screen is showing.
- Test every video, especially if it comes from the internet.
- Run `mdeck check my-talk.md` to look for missing files or settings mistakes.
- If the talk has a poll, scan its QR code with a phone in the room's network and vote once. Then reset the poll.

## Are my notes private?

Notes are hidden from the audience view, but a normal build includes them in the file, and someone with that file can inspect them. For a version to send around, use `mdeck send my-talk.md`, which removes the notes (see [Send, host or print your slides](sharing.html)).
