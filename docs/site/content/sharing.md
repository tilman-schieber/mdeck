# Send, host or print your slides

The launch page that `mdeck run my-talk.md` opens has buttons for the three most common results: a folder to host, one file to send, and a PDF. The hosted folder and sent file open in the reader view and omit speaker notes. Each is made next to your slide file. The commands below do the same from the terminal and offer more options.

| You want | Command | You get |
|---|---|---|
| One file to email | `mdeck send my-talk.md` | `my-talk.html`, opening in the reader view |
| A folder for a website | `mdeck build my-talk.md --reader` | `dist/`, opening in the reader view, without notes |
| A PDF | `mdeck pdf my-talk.md` | `my-talk.pdf` |

## Send slides to someone

The quickest way to give slides to people who were not in the room:

```sh
mdeck send my-talk.md
```

Send `my-talk.html` by email. It opens in a **reader view**: an outline of all slides on the left, the slides in the middle, a **Read** mode that stacks every slide for scrolling on a phone, a **Light**/**Dark** button, a **Download PDF** button, and a **Present** button that opens standalone slides. The PDF is inside the file, so there is nothing else to attach.

- Drawings from `my-talk.drawings.json` are part of every build and PDF; `--no-drawings` leaves them out. Readers can hide them with the **Drawings** button in the reader view. See [Draw on your slides](drawing.html).
- Your speaker notes are removed. Add `--notes` to keep them in the file, for example when you also present from the same file. Readers only see notes if you put `reader:` with `notes: true` in the settings at the top of your slide file.
- Slides with a poll, question, word cloud or scale stay as a record of the talk: the question and its options, marked as answered live. Add `--no-polls` to leave them out of the file and its PDF, together with slides showing the join code (`<qrcode join />`).
- `--slide 12-30` sends only some slides, for example the part of a deck shown in today's lecture. The numbers are the slides' places in the deck, as `mdeck check --render` and `mdeck snapshot` count them, and may be listed, `3,5-7`. Drawings stay on their slides, and a `<style>` written on a slide that is left out still applies.
- The PDF is made while sending, using Chrome or Chromium on your computer. If neither is found, the button offers the browser's own "Save as PDF" dialog instead. Set `MDECK_CHROME` to the browser's path if it is installed somewhere unusual. `--no-pdf` skips it.
- `-o` chooses the name: `mdeck send my-talk.md -o handout.html`.
- The file keeps your theme and colours; readers can only switch between light and dark. To keep that fixed too, put `reader:` with `themes: false` in the settings at the top of your slide file.

Anyone who opens a normal build can reach the reader view through the small **Overview** link in the corner, or by adding `?view=reader` to the address. [Views, commands and servers](views.html) lists every view. Likewise `?view=presenter` opens the presenter view of any build, as long as the notes were kept in the file.

## Make a PDF on its own

```sh
mdeck pdf my-talk.md
mdeck pdf my-talk.md -o handout.pdf
```

Each slide becomes one page at the slide's own size, with real text you can search and copy. Points that appear one at a time are all shown, and interactive slides such as diagrams that build up step by step appear finished. The reader's **Read** mode shows them the same way.

A PDF is useful for reading or printing. Videos do not play in it, and interactive slides are shown in their finished state. A poll shows the answers it had when the PDF was made. You can also open a built presentation in your browser and choose **Print**, then **Save as PDF**; turn off the browser's own headers and footers if they appear.

## Make a folder you can host

While you write, mdeck reads your text file. To put the presentation on a website, **build** it: ask mdeck to make a browser-ready version of your talk.

```sh
mdeck build my-talk.md --reader
```

mdeck creates a folder called `dist`. It contains `index.html` and the local pictures, videos, and audio files the presentation uses.

Send or upload the whole folder, not just `index.html`. You can compress the folder into a ZIP file first. This option is usually best for talks with large videos. `--reader` opens the reader view and removes speaker notes from the HTML. Add `--notes` to retain them; `reader.notes: true` also makes them visible. Without `--reader`, a normal build opens the deck view and retains notes.

Building again updates the output. Keep your original slide file and pictures outside `dist`, because mdeck replaces the build output. `mdeck preview` shows the built folder in your browser.

## Put the presentation on a website

The built folder can be hosted as an ordinary static website. Upload its contents together so the relative image and video paths keep working. Every build contains every view; the address picks it: `?view=deck`, `?view=reader`, `?view=presenter` or `?view=audience`. Polls do not need the slides to be hosted; see [Ask your audience](audience.html#use-it-in-a-real-session).

Building does not publish anything automatically. Uploading or deploying the files is a separate step with your hosting provider.

## Make one HTML file of the presentation

If you need the presentation itself, not the reader view, as a single file to transfer, use:

```sh
mdeck build my-talk.md --single-file -o my-talk.html
```

Here, `-o` means “save the result with this name.” The file contains the presentation and embedded local media. Videos become larger when embedded, so a folder is often more convenient for a video-heavy talk.

The recipient can open the HTML file in a modern browser. External websites, online videos, and downloadable tools such as live Python still need a network connection. Fonts may look slightly different because this mode uses the theme's system-font alternatives.

## Present without installing mdeck

You can include small launchers with a folder build:

```sh
mdeck build my-talk.md --launchers
```

The folder then includes `present.sh` for macOS/Linux, and `present.bat` plus `present.ps1` for Windows. These start a local web server and open the presenter view. The other computer needs Python 3 and a modern browser.

Use this with a folder build; it cannot be combined with `--single-file`.

## Check before sending

Open the final result, try its images and videos, and make sure the whole talk is there. If you expect to be offline, test without an internet connection.

Remember that speaker notes are included in a normal build, even though they are hidden on the audience screen. `mdeck send` and `mdeck build --reader` remove them; remove anything confidential before building a public copy.
