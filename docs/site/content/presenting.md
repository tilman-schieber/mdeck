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

To jump to a slide, tap or click the slide number in the presenter view (beside the arrows on an iPad, at the top of the speaker layout), type the number and press Enter, or Go on an iPad's keyboard. Escape keeps the current slide.

Click the slide area if your keys are not controlling it. Keys behave normally while you are typing in a text field.

The timer is for your own reference; you can start, pause, and reset it in the presenter view.

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

Each press of the next key reveals one point. Once all points are visible, the next press moves to the following slide. Printed slides show all the points.

## Before the talk

- Open the talk on the computer you will use.
- Try the audience window and check the correct screen is showing.
- Test every video, especially if it comes from the internet.
- Run `mdeck check my-talk.md` to look for missing files or settings mistakes.
- If the talk has a poll, scan its QR code with a phone in the room's network and vote once. Then reset the poll.

## Are my notes private?

Notes are hidden from the audience view, but a normal build includes them in the file, and someone with that file can inspect them. For a version to send around, use `mdeck send my-talk.md`, which removes the notes (see [Send, host or print your slides](sharing.html)).
