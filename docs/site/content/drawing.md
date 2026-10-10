# Draw on your slides

You can draw on a slide while you present, or ahead of time: circle a number, underline a line of code, sketch an arrow. It works with a mouse, a finger, and best with an iPad and its pencil. What you draw is kept with the presentation and shows again the next time you present it, in the reader view and in PDFs.

## Start drawing

Press **D** in standalone slides or in the presenter view, or use the pen button (**Draw** in the presenter view). A toolbar appears on the slide:

| Tool | What it does |
|---|---|
| Pen | Thin to thick with the pencil's pressure. Kept. |
| Highlighter | A wide, see-through stroke in its own colours, always below the pen's strokes. Kept. |
| Select and move | Draw a loop around strokes, or tap one, to select it; a finger's tap on a stroke selects it with any tool. Drag inside the dashed box with the pen to move it; a straight line shows handles at its ends, which the pen moves. **Delete** (or the toolbar's bin) removes the selection. |
| Laser pointer | A red dot with a white core and a trail that stays as long as the pen or finger is down and disappears by itself once it is lifted, for pointing at something or circling it. With a pencil that can hover, the dot follows it without touching. Never kept. |
| Eraser | Removes whole strokes you touch. |

**Zoom**: two fingers zoom into the slide and move around it, one finger moves a zoomed slide, and Ctrl + scroll (a trackpad pinch) zooms on a laptop. Only the slide grows; the bars and the toolbar keep their size. The audience window shows the same part of the slide. **1:1** at the top left shows the whole slide again, as does the next slide.

On a touch screen such as an iPad, drawing is on as soon as the presenter view opens, and in the deck as soon as the pencil touches it, with the toolbar folded into its button in the bottom right corner (↘ folds it again). Until then, a tap on the right third of the screen goes forward, on the left third back, and a swipe does the same. Drawing starts with the laser pointer; choose the pen or the highlighter to write. The pen and the highlighter each have colours and three sizes, and each keeps its own; one pen colour is **Accent**, the accent colour of the theme and palette: a drawing in it changes with them. The other pen colours follow light and dark: on dark slides red, blue and green are lighter, and the text colour is white instead of black. The toolbar also has undo and redo (also Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z), **Clear this slide**, and **×** to stop drawing; **D** and **Escape** do the same. While you draw, the pencil and the mouse draw; fingers keep working: a swipe to the left goes forward, to the right back, a tap on a stroke selects it, and buttons and polls on the slide still respond. Turn slides with the arrow keys or the presenter view's arrows, as always. Holding the pen still for half a second at the end of a stroke makes it a straight line; near a multiple of 15° (horizontal, vertical, 45° …) it snaps to that angle.

**I** hides and shows what was drawn before, for example when a slide should look clean again. The toolbar has the same switch.

The audience window, and any other deck window in the same browser, shows every stroke as you draw it.

## Where drawings are kept

Drawings live in a file next to your slides: `my-talk.drawings.json` for `my-talk.md`. Keep the two together, and send or check in both.

- **With `mdeck run`**, each stroke is saved in that file as soon as you lift the pen. Nothing reloads, and the talk goes on.
- A slide that gets its first drawing receives an `id:` in its settings, made from its heading, for example `id: the-important-part`. The drawing stays with that slide when you add or move slides. If you change the `id:` in the editor, the drawing moves with it.
- If you delete a slide that has drawings, they stay in the file. `mdeck check` tells you about them; bring the slide back, or delete them from the file.
- The first save of a session keeps a copy of the previous file in `.mdeck-backups`, next to your slides.
- **Opened from a built folder or a single file**, the page has nowhere to save. Drawings are kept in that browser, and the toolbar's download button saves them as the drawings file, to put next to your slides. Safari may clear such browser data after a week without use, so download it after drawing.

Builds and PDFs include the drawings. In the reader view, which a file from `mdeck send` opens in, a **Drawings** button hides and shows them, also for **Save as PDF**; the browser remembers the choice. To leave them out of a build altogether, add `--no-drawings`:

```sh
mdeck pdf my-talk.md --no-drawings
```

## Present from an iPad

There are two ways.

**The iPad on its own.** Connect it to the projector, which usually shows the same picture as the iPad, and open standalone slides with **Present** from the reader view. Swipe left or right to go forward or back, also while drawing. This keeps notes off the wall.

**The iPad next to your laptop.** The laptop shows the slides on the projector; you draw and go through the slides on the iPad, with your notes on it.

1. Start `mdeck run my-talk.md --network`, so the iPad in the same network can reach your laptop.
2. On the launch page, under **Present from an iPad**, choose **Show pairing code** and scan it with the iPad's camera. The presenter view opens on the iPad, paired with your laptop, so it may save drawings and steer the phones of a poll. It is the same presenter view as on the laptop; pairing only gives it these rights. Once it is open, the launch page says so.
3. On the laptop, open the **audience window** from the same place and move it to the projector. It follows the iPad: slides, revealed points, drawings as you draw them, and videos. Navigation in the audience window also updates the iPad's slide, notes and next-slide preview.

**Videos.** A video file on a slide (`<videoplayer src="…" />`) plays, pauses and jumps on the projector as you tap it on the iPad. The sound comes from the projector: while the audience window is open, the iPad's copy plays silently. Browsers start sound only on a page someone has clicked, so click the audience window once before the talk (going full screen counts); otherwise the video plays there without sound and shows **Click for sound**.

Online videos (`<videoplayer url="…" />` from YouTube, Vimeo or SwitchTube) do not follow the iPad. They run inside the video service's own player, which mdeck cannot start or stop, so they play only on the screen where you start them. For a talk from the iPad, start them in the audience window on the laptop, or download the video and use a video file.

A pairing code works once, for ten minutes. **Unpair** on the launch page ends every pairing; so does stopping `mdeck run`. Scan a new code afterwards.

**The iPad on another network.** Some networks, often big Wi-Fi networks at universities, do not let devices reach each other, and a laptop's firewall may not let the iPad in. With a server of your own (see [Ask your audience](audience.html#use-it-in-a-real-session)) the iPad does not need to reach your laptop at all: your laptop connects out to the server, and the server passes the iPad's requests to it. The slides are not uploaded or stored anywhere.

1. Tell mdeck where your server is: `server: https://rooms.example.org` in the deck's settings, or `MDECK_SERVER` in your shell, or the address after the option in the next step.
2. Start `MDECK_SERVER_KEY=your-key mdeck run my-talk.md --server`. The key is the one the server was started with.
3. On the launch page, choose **Show pairing code** under **Present from an iPad** and scan it. The address in the code is on your server and contains a long random name, so treat it like a private link.
4. Open the **audience window** on the laptop as before. It follows the iPad through the server.

Everything else works as with `--network`: drawings are saved in the drawings file beside the deck, and the iPad may steer polls. Editing the slides on the laptop reloads the iPad too. The server only passes on what the presenter and audience pages need; the launch page, the editor and the other files in your folder are not reachable through it. Stopping `mdeck run` ends the connection, and a pairing code stops working when you unpair or stop.

On a touch screen the presenter view shows only the slide, with a small bar at the top: timer, previous and next, draw, **Notes** (a drawer with your notes and the next slide, also **N**), full screen, and a button back to the layout with notes beside the slide. Your choice is remembered on that device.

With a server of your own (the `server` setting, see [Ask your audience](audience.html)), the same also works with a hosted deck: open the presenter view on the iPad with your key (`?serverkey=…`), and the audience window anywhere else follows it. With the deck opened through `mdeck run` and the server's key set (`MDECK_SERVER_KEY`), the paired iPad and the audience window talk over your own network, and only the polls go through the server. Drawings are then kept on the iPad; download the drawings file after the talk.

## Tips for the iPad

- **Full screen**: the full-screen button (four corners) or **F**, where the browser allows it. Safari on an iPhone does not. Alternatively, use Share → **Add to Home Screen**: the deck then opens without Safari's bars. Such a Home Screen app keeps its own browser data, apart from Safari's.
- **Fingers and the pencil**: the pencil draws, fingers operate the slides, also while drawing. Swipe left to go forward, right to go back; tap a stroke to select it. To draw with a finger (on a device without a pencil), switch on the hand button on the toolbar; fingers then draw instead.
- **Networks**: many large Wi-Fi networks do not let devices reach each other. If the iPad cannot open the pairing code, connect both to a phone hotspot.
