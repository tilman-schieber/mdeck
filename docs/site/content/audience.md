# Ask your audience

A slide can ask a question that people answer on their phones, with the results appearing on the slide as they come in.

Your assistant can add these for you. Say what you want to find out and where in the talk:

```prompt
Before the chapter on methods, ask which of the three methods people
have used, and end with a slide for open questions. Show the QR code
once at the start.
```

The rest of this page shows what it writes, and how to run the questions in a real room.

## Add a poll

```markdown
---
# Where do we eat?

<poll room="lunch" options="Mensa|Thai|Pizza|Salad" />
```

The slide shows one bar per option, the number of answers, a QR code and a short link. Scanning the code opens a small answer page on the phone with one button per option. Each phone has one vote and can change it; the bars follow the latest answer.

Every poll in a presentation shows the same code, so people scan once. Their phones then follow along: when you reach a slide with a poll, its buttons appear on every phone; between polls, the phones say that the next question will appear there. You can show the code at the start of the talk, or on the first poll.

| Setting | Meaning |
|---|---|
| `room` | A short name for this question, different for each poll in the deck. Letters, digits, hyphens and underscores. |
| `answer` | Optional: the right answer, written exactly like the option (several separated by `\|`). A button with a tick then appears under the bars; tapping it outlines the right answer, its bar and its number in green, and each phone says whether its vote was right. Tapping again hides it. |
| `options` | The answers, separated by `\|` |
| `question` | Optional question text. Without it, phones show the slide's heading. |
| `multiple` | Each phone may pick several options. The slide and the phones say “Several answers possible”. Without it, one option per phone. |
| `buttons` | `letters` puts A, B, C … before the options on the slide, and the phones show only those letters; `numbers` does the same with 1, 2, 3 … For options that are pictures or long formulas, better read on the big screen. |
| `results` | `hidden` starts with the bars hidden, e.g. to let people vote before they see what others chose. |
| `qr` | Puts the deck's join code beside the question. Usually not needed: **J** shows it over any slide (see below). |

The question and the options may contain formatting and formulas, written as on a slide, so a maths lecture can ask:

```markdown
<poll room="derivative" question="What is $\frac{d}{dx}\, x^2$?" options="$2x$|$x^2$|$\frac{x^3}{3}$" answer="$2x$" />
```

Both the slide and the phones show the formulas. A `|` inside a formula stays in it, so `$|x|$` is one option; to put a `|` in plain text, write `\|`.

When the options get long, write them as a list inside the tag instead, one option per line, and tick the right one with `[x]`:

```markdown
<poll room="derivative" question="What is $\frac{d}{dx}\, x^2$?">

- [x] $2x$
- [ ] $x^2$
- [ ] $\frac{x^3}{3}$

</poll>
```

Nothing needs escaping there, and the right answer is marked where it stands.

Options can also be pictures. Show only letters on the phones then:

```markdown
<poll room="graph" question="Which graph shows $f(x) = e^{-x}$?" options="![](a.svg)|![](b.svg)|![](c.svg)" answer="![](b.svg)" buttons="letters" />
```

### During the poll

Below the bars, the slide counts the answers, “12 of 31 answered” while phones are connected. The presenter has three buttons there (the audience window does not show them):

- **The lock** closes the poll. Answers after that do not count, and the phones say the poll is closed until you open it again.
- **The eye** hides or shows the bars. Hidden, the audience sees no bars; your own screens show them faint.
- **The tick** (with `answer`) shows the right answer: on the slide, and on each phone, which says whether its answer was right.

Together they make a peer-instruction round: start with `results="hidden"`, let people vote, close, show the bars, let them discuss, and show the answer. **Reset** clears the answers and opens the poll again.

With `lang: de` in the settings, the slide and the phones show German words, such as “Scannen und abstimmen”. The phones use the presentation's colours and fonts; if you pick another theme or palette in the presenter view, the phones change with it.

## Other kinds of questions

Besides a poll, five more kinds work the same way: one line on a slide, answered on the phones.

```markdown
<scale room="pace" min="1" max="5" low="Too slow" high="Too fast" />
<numeric room="limit" question="What is $\lim_{x \to 0} \frac{\sin x}{x}$?" answer="1" />
<wordcloud room="mood" placeholder="One word" />
<question room="ask" placeholder="Your question" />
```

| Tag | Phones show | The slide shows |
|---|---|---|
| `<scale>` | The numbers from `min` to `max` (1 to 5 unless set, at most 11 steps), with `low` and `high` as labels at the ends | How many chose each number, and the average. Each phone's latest answer counts |
| `<numeric>` | A field for a number: `0.5`, `0,5`, `1/2` or `1e-3` | The most frequent answers as bars, six unless `limit` says otherwise, and the rest as Other. With `answer`, the tick marks the right ones and counts them, and each phone hears whether it was right; `tolerance` (0 unless set) says how far off still counts. Each phone's latest answer counts |
| `<wordcloud>` | A short text field | A cloud of every answer, packed around the middle, larger the more often it came in and some upright. Capitals and extra spaces do not matter. Each phone counts with one word: a new one replaces its earlier word. `height` sets its height (520). Colours come from the palette; `--cloud-1` to `--cloud-6` override them |
| `<question>` | A text field | The newest answers as cards, eight unless `limit` says otherwise. People may send several |

### Tap on a picture

`<pinpoint>` shows a picture on the phones; people tap the spot and send it. The slide shows every tap as a dot on the picture:

```markdown
# Where is the left atrium?

<pinpoint room="heart" src="img/heart.png" answer="62% 31% 8%" />
```

`answer` is a circle: its middle across and down, and its radius, in percent of the picture (the radius as a share of its width). Pixels work too, as an image editor shows them: `answer="412 230 40"`. The tick draws the circle, colours the dots inside green, says how many hit, and tells each phone whether its tap did. Without `answer` the slide simply shows where people tapped. `height` sets the picture's height on the slide (520), and `results="hidden"` hides the dots until you show them, as for a poll.

The phones get the picture from the server, made smaller (at most 1000 px), and the server keeps it only while the question is on screen: you need nothing else, but a server of your own must run this version of mdeck. `mdeck results` writes each tap as `62.1% 31.4%`, and the summary counts the taps on and off target.

All of them take `room`, `question` and `qr` like a poll, and `placeholder` for the text fields. Their `question`, and the scale's `low` and `high`, may contain formatting and formulas like a poll's options. All of them have the lock that closes them; `<numeric>` and `<pinpoint>` also have the eye and the tick, and take `results="hidden"`.

## Let phones join

Questions show no QR code of their own. When people should join, press **J** in the presenter view (or the QR-code button): the deck's join code appears large over the slide on the projector and every other screen, with the link below it. Phones that scanned it follow along to every question. **J** again, or the next step, shows the slide again; press it once more for people who arrive late.

To keep the code on a slide of its own, or beside one question, write it there:

```markdown
---
# Take out your phone.

<qrcode join />

---
# How do you make slides today?

<poll room="tools" options="PowerPoint|Keynote|Markdown" />
```

`<qrcode join />` shows the join code large on that slide (`size` sets its size); `qr` on a question puts the code beside it.

The presenter view's connection icons show the join link to copy, and whether phones can reach the poll server.

The code is drawn in the slide's colours, so it fits the theme; phone cameras also read light codes on dark slides.

### Follow the slides on a phone

`<qrcode follow />` shows a code that opens your slides on people's phones and laptops, following you: the slide you show, step by step, and what you draw. They can page back to read something again and return with **Back to live**; slides you have not shown yet stay hidden. The phones' answer page links to it too (**Follow the slides**), so one join code can do both.

It needs their devices to reach your slides: present with `mdeck run --network` when everyone is on the same Wi-Fi (it prints the **Follow** address), or host the built deck with a `server` setting for people anywhere.

### Reactions

Let people react while you talk, with or without a question on screen:

```markdown
---
reactions: true
---
```

The phones' answer page then has a row of buttons, 👍 👏 ❤️ 😮 🤔, below the question or while they wait for the next one. A tap floats up in the corner of your presenter view for a moment, and a small tally keeps what came in the last minute, so a few 🤔 still show after they faded. The audience window and the projector never show them. Give your own, up to eight emoji or short words, for example to ask for a pace: `reactions: [👍, 🤔, slower, louder]`. Each phone can react about once a second; reactions are not kept anywhere.

People reach the answer page through the join code: press **J** in the presenter view to show it, also in a deck with reactions and no questions.

Hover over the results to see **Reset**, which clears the answers, for example before the real session; the phones forget their choice with it. Only the presenter can reset.

## How phones and slides meet

The phones never load your slides. A small **server** connects your screen and the phones: your screen tells it which poll is showing and what the phones should display, and the server shows that on its own answer page, at an address like `example.org/482113`. The six digits are the presentation's session code; they stay the same for the whole talk.

So you present from your own computer with `mdeck run`, always with the slides as they are right now, and nothing needs to be uploaded. Only the server has to be reachable by the phones.

## Try it on your computer

`mdeck run` has a server built in:

```sh
mdeck run my-talk.md --network
```

`--network` makes it reachable from phones and tablets in the same network, and the QR code then points at your computer. Without `--network`, the slide says so and offers a link to try the answer page in another browser tab on your computer. The launch page shows the join link and the session code too.

Some networks, often large Wi-Fi networks at universities, do not let devices reach each other. If phones cannot open the page, connect your laptop and the phones to a phone hotspot, or use a server on the internet (below).

## Use it in a real session

For a lecture hall, run your own server once on a web server; it can serve all your presentations, and it also lets an iPad present from any network (see [Draw on your slides](drawing.html#present-from-an-ipad)). On that machine, install mdeck and start it:

```sh
MDECK_SERVER_KEY=choose-a-secret mdeck server
```

It listens on `127.0.0.1:8787`. Give it a host name of its own, such as `rooms.example.org`, and make your web server pass everything on that name to it, for example with nginx:

```nginx
# in the http block
map $http_upgrade $connection_upgrade { default upgrade; '' ''; }

server {
  server_name rooms.example.org;
  # your usual listen and certificate lines here

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

The slides and phones keep a connection open to receive answers live, which is why buffering is off and the timeout long. The `Upgrade` lines let WebSocket connections through, which presenting from an iPad needs; polls alone work without them. `X-Forwarded-For` lets the server limit each phone, not the web server as a whole. A server on a path of a shared host name, such as `example.org/rooms/`, works for polls too, but presenting from an iPad needs a name of its own.

`MDECK_SERVER_KEY` is required for presenting from an iPad: a server without a key does not offer it, and a laptop that does not know the key cannot connect. The server only passes requests along: it keeps nothing of your slides, and a presentation shared through it disappears when the laptop disconnects or the server restarts.

To keep the server running and start it with the machine, a systemd service works well. Put the key in a file only root can read, for example `/etc/mdeck-server.env` with the line `MDECK_SERVER_KEY=choose-a-secret`, and create `/etc/systemd/system/mdeck-server.service`:

```ini
[Unit]
Description=mdeck server
After=network.target

[Service]
EnvironmentFile=/etc/mdeck-server.env
ExecStart=/usr/local/bin/mdeck server --port 8787
User=www-data
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Adjust `ExecStart` to where `which mdeck` points; if Node is installed in a home folder, for example with nvm, also remove `ProtectHome=true`. Then run `sudo systemctl enable --now mdeck-server`. `journalctl -u mdeck-server` shows its log. After updating mdeck, `sudo systemctl restart mdeck-server`; rooms start empty again.

Then tell the presentation where the server is:

```yaml
---
server: https://rooms.example.org
---
```

To keep the address out of the deck, leave the setting out and set `MDECK_SERVER=https://rooms.example.org` in your shell instead. With `MDECK_SERVER_KEY` set as well, `mdeck run` then uses the server by itself, without `--server`; when the server does not answer, it says so and presents from your computer, and `--no-server` leaves it out on purpose. A built or sent presentation reads the address from the deck only, because it has to carry it to wherever it is opened.

`MDECK_SERVER_KEY` is the server’s master key. `mdeck run` keeps it on your computer and lets your local browser, or an iPad with a revocable pairing token, move the phones along and reset polls for this deck. Pairing QR codes never include the master key. Start `mdeck run` with the same key (`MDECK_SERVER_KEY=choose-a-secret mdeck run my-talk.md`), and the launch page checks the server, shows the join link and opens the presenter view. Paired devices remember only their token, scoped to this presentation; it never appears in the address bar or in the slide file. A hosted presenter can still unlock the server by opening the presenter view once with `?serverkey=…` in its address. That browser remembers the master key. Without permission to control the server, phones wait. The presenter view says whether the phones follow it, and if not, why.

The presenter's screen repeats the current poll every few seconds, so phones that join late, or a server that restarted, catch up. While a presenter view is open, other windows of the presentation in the same browser leave the phones alone. If the presentation is open on several screens, even in other browsers, the phones follow the one where the slides were changed last; just opening it elsewhere does not take them away. A presenter view that has lost the phones says so, and changing the slide there takes them back.

Two presentations with the same title share a session code. Give one of them `session: id:`, or set the digits yourself with `session: code:`.

## What is stored

Answers are anonymous. Each phone gets a random number so it can change its vote; nothing else identifies it, and the slides see only a disguised form of that number. A phone remembers its choice for twelve hours, so a reload keeps it. The server keeps answers in memory only. It forgets a room after twelve hours without visitors and everything when it restarts. Each phone can send a limited number of answers in a short time.

While you present with `mdeck run`, the answers are also kept beside the presentation, in `my-talk.results.json`. It holds each answer with its time, and the phones numbered 1, 2, 3 … per question instead of their random numbers. Once a question was closed, only the answers that counted. **Reset** takes a question's answers out of the file; a new server that starts empty leaves the file as it is. A deck hosted with its own `server` keeps nothing beside it.

### Save the answers

Under **Answers from the talk**, the launch page lists each question with how many phones answered and how it came out, and saves the answers as a file:

- **Answers (CSV)**: every answer on its own row, with the slide, the question, the phone's number and the time, to open in a spreadsheet.
- **Summary (CSV)**: one row per option, number on a scale, number typed or word, with how many chose it and their share; for scales and numbers also the average and the median. It counts as the slide does: each phone's last vote.
- **Everything (JSON)**: all of it, for other programs.

On the command line, `mdeck results my-talk.md` prints the answers as CSV, `--summary` the summary and `--json` everything; `-o answers.csv` (or `.json`) saves them to a file.

## In a PDF or a shared file

A PDF, a file made with `mdeck send` and a folder hosted without a poll server keep your questions as a record of the talk, without a join code. With answers kept in `my-talk.results.json`, each shows its results as they were at the end of the talk; without, its question and options with a note that it was answered live. `--no-results` leaves the kept answers out. If the deck's `server` still answers when the file is opened, the results it holds appear instead. Printed slides never show the join code or the presenter's buttons.

## Make your own activity

Polls, scales, word clouds and questions are ordinary components. The [interactive content](components.html#audience-interaction) guide shows how to write your own, such as a quiz, or ask your assistant to write one.
