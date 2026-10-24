// The phone page the server serves at <server>/<code>. It needs no deck:
// the presenter's screen sends the activity on screen (what to ask and how to
// answer), the deck's look and the words in the deck's language, and this page
// shows them. Plain browser JavaScript, no build step.
(() => {
  const base = new URL('.', location.href)
  const code = location.pathname.split('/').filter(Boolean).pop()
  const root = document.getElementById('answer')
  const FALLBACK = {
    en: {
      waiting: 'The next question will appear here.', pick: 'Tap one answer.', thanks: 'Thanks! You chose “{choice}”. Tap another to change.', send: 'Send', sent: 'Sent. Thank you!', offline: 'Connecting…',
      pickSeveral: 'Tap all that apply.', thanksSeveral: 'Thanks! You chose {choice}. Tap to change.', closed: 'Closed: no more answers.',
      right: 'Right!', wrong: 'Not quite. The right answer: {answer}', solution: 'The right answer: {answer}',
      number: 'A number', invalid: 'Enter a number, such as 0.5 or 1/2.', numberSent: 'Sent: {value}. Send another to change.',
      react: 'React',
      pinPick: 'Tap the spot.', pinConfirm: 'Move the pin if needed, then send.', pinSent: 'Sent. Tap elsewhere and send again to change.', pinLoading: 'Loading the picture…',
      pinWrong: 'Not quite: the circle shows the right spot.', pinSolution: 'The circle shows the right spot.',
    },
    de: {
      waiting: 'Die nächste Frage erscheint hier.', pick: 'Eine Antwort antippen.', thanks: 'Danke! Gewählt: „{choice}“. Zum Ändern eine andere antippen.', send: 'Senden', sent: 'Gesendet. Danke!', offline: 'Verbinde…',
      pickSeveral: 'Alle zutreffenden antippen.', thanksSeveral: 'Danke! Gewählt: {choice}. Zum Ändern antippen.', closed: 'Geschlossen: keine weiteren Antworten.',
      right: 'Richtig!', wrong: 'Leider nicht. Richtig ist: {answer}', solution: 'Richtig ist: {answer}',
      number: 'Eine Zahl', invalid: 'Eine Zahl eingeben, z. B. 0,5 oder 1/2.', numberSent: 'Gesendet: {value}. Zum Ändern eine andere senden.',
      react: 'Reagieren',
      pinPick: 'Auf die Stelle tippen.', pinConfirm: 'Pin bei Bedarf verschieben, dann senden.', pinSent: 'Gesendet. Zum Ändern woanders tippen und erneut senden.', pinLoading: 'Bild wird geladen…',
      pinWrong: 'Leider nicht: Der Kreis zeigt die richtige Stelle.', pinSolution: 'Der Kreis zeigt die richtige Stelle.',
    },
  }
  let words = FALLBACK[navigator.language?.slice(0, 2) === 'de' ? 'de' : 'en']
  let current = null
  let connected = false
  let status = ''
  // What is typed into a field, kept while the page redraws.
  let draft = ''
  // Where a <pinpoint> pin was put and not yet sent.
  let pinDraft = null

  const me = (() => {
    try {
      let id = localStorage.getItem('mdeck-live-client')
      // randomUUID only exists on https or localhost, not at `mdeck run --network`'s http://192.168…
      if (!id) localStorage.setItem('mdeck-live-client', id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''))
      return id
    } catch { return String(Math.random()).slice(2) }
  })()
  // What this phone answered, so it shows after a reload and can be changed.
  // The server forgets a room after twelve hours, and so does the phone: the
  // same talk given next week does not start with last week's choice.
  const REMEMBER_MS = 12 * 60 * 60 * 1000
  const chosenKey = room => `mdeck-answer:${code}.${room}`
  const remembered = room => {
    try {
      const kept = JSON.parse(localStorage.getItem(chosenKey(room)))
      return typeof kept?.value === 'string' && Date.now() - kept.at < REMEMBER_MS ? kept.value : null
    } catch { return null }
  }
  const remember = (room, value) => { try { localStorage.setItem(chosenKey(room), JSON.stringify({ value, at: Date.now() })) } catch {} }
  const forget = room => { try { localStorage.removeItem(chosenKey(room)) } catch {} }
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (all, name) => vars[name] ?? all)
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
      else if (value != null && value !== false) node.setAttribute(key, value === true ? '' : value)
    }
    node.append(...children.flat(Infinity).filter(child => child != null))
    return node
  }

  // Languages written from right to left, as src/core/languages.js knows them.
  const RIGHT_TO_LEFT = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ks', 'ku', 'nqo', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi'])
  // The deck's colours and fonts, as the presenter's screen shows them, and
  // its language, which sets the direction of the page.
  function applyLook(look, lang) {
    if (typeof lang === 'string' && lang.trim()) {
      document.documentElement.lang = lang
      document.documentElement.dir = RIGHT_TO_LEFT.has(lang.trim().toLowerCase().split('-')[0]) ? 'rtl' : 'ltr'
    }
    // No look: keep the one the page has, fonts included.
    if (!look?.tokens) return
    const style = document.documentElement.style
    for (const [name, value] of Object.entries(look?.tokens ?? {})) if (/^--[\w-]+$/.test(name)) style.setProperty(name, value)
    for (const [name, value] of Object.entries(look?.heading ?? {})) style.setProperty(`--answer-heading-${name}`, value)
    const wanted = (look?.fonts ?? []).filter(url => /^https:\/\//.test(url))
    for (const link of [...document.querySelectorAll('link[data-theme-font]')]) if (!wanted.includes(link.href)) link.remove()
    for (const url of wanted) if (!document.querySelector(`link[data-theme-font][href="${CSS.escape(url)}"]`)) document.head.append(el('link', { rel: 'stylesheet', href: url, 'data-theme-font': true }))
  }

  // A question or option drawn by the deck (Markdown and maths as MathML,
  // src/components/inlineText.js), kept to text, emphasis and MathML. The
  // nodes are moved out of the parsed document, never parsed again.
  const SAFE_TAGS = new Set('em strong b i code del s sub sup br math semantics annotation mrow mi mo mn ms mtext mspace msup msub msubsup mfrac msqrt mroot mstyle mover munder munderover mtable mtr mtd mpadded mphantom menclose'.split(' '))
  const SAFE_ATTRIBUTES = new Set('mathvariant display displaystyle scriptlevel stretchy fence separator symmetric largeop movablelimits accent accentunder lspace rspace minsize maxsize linethickness width height depth voffset columnalign rowalign columnspacing rowspacing notation encoding'.split(' '))
  const DROPPED = new Set('script style template noscript iframe object embed svg textarea title'.split(' '))
  function clean(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue
      if (child.nodeType !== Node.ELEMENT_NODE || DROPPED.has(child.localName)) { child.remove(); continue }
      clean(child)
      if (!SAFE_TAGS.has(child.localName)) { child.replaceWith(...child.childNodes); continue }
      for (const { name } of [...child.attributes]) if (!SAFE_ATTRIBUTES.has(name)) child.removeAttribute(name)
    }
    return node
  }
  const drawn = (html, text) => {
    if (typeof html !== 'string') return text
    const body = clean(new DOMParser().parseFromString(html, 'text/html').body)
    return el('span', { class: 'answer-rich' }, ...body.childNodes)
  }
  // An option as this phone shows it: its key (A, B… with `buttons`), or drawn.
  const shown = (activity, value) => {
    const i = activity.options.indexOf(value)
    return activity.keys?.[i] ?? drawn(activity.optionsHtml?.[i], value)
  }
  // A sentence with nodes put in for {name}; without {name}, the sentence.
  const sentence = (text, name, part) => {
    if (!text.includes(`{${name}}`)) return text
    const [before, after] = text.split(`{${name}}`)
    return [before, part, after]
  }
  const listed = parts => parts.flatMap((part, i) => i ? [', ', part] : [part])

  // A number as src/components/Numeric.jsx reads it: 0.5, 0,5, −3, 1e-3, 1/2.
  function parseNumber(text) {
    const plain = String(text ?? '').trim().replace(/\s+/g, '').replace(/\u2212/g, '-').replace(/(\d),(\d)/g, '$1.$2')
    const parts = plain.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:\/((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?))?$/i)
    if (!parts) return null
    const value = parts[2] ? Number(parts[1]) / Number(parts[2]) : Number(parts[1])
    return Number.isFinite(value) ? value : null
  }

  // The activity's controls (src/components/activity.jsx), from its room's
  // state: `closed`, and `revealed` with the `solution` once the right
  // answer shows. Only the state, not everyone's answers (?only=state).
  let controls = {}, controlRoom = null, controlSource = null
  function followControls(room) {
    if (room === controlRoom) return
    controlSource?.close()
    controlSource = null
    controls = {}
    controlRoom = room
    if (!room) return
    controlSource = new EventSource(new URL(`rooms/${encodeURIComponent(`${code}.${room}`)}/events?only=state`, base))
    const take = event => {
      const state = JSON.parse(event.data).state
      controls = state && typeof state === 'object' ? state : {}
      render()
    }
    controlSource.addEventListener('snapshot', take)
    controlSource.addEventListener('state', take)
    // Reset on the slide: this phone's answer went with the others.
    controlSource.addEventListener('reset', () => { forget(room); status = ''; pinDraft = null; render() })
  }
  // Once the right answer shows: whether this phone's was right, or what it is.
  const verdict = (answered, right, solution) => el('p', { class: `answer-verdict${answered ? (right ? ' is-right' : ' is-wrong') : ''}`, role: 'status' },
    answered ? (right ? words.right : sentence(words.wrong, 'answer', solution)) : sentence(words.solution, 'answer', solution))
  const statusLine = text => el('p', { class: 'answer-status', role: 'status' }, status || (controls.closed ? words.closed : text))

  async function answer(room, value) {
    const response = await fetch(new URL(`rooms/${encodeURIComponent(`${code}.${room}`)}`, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: me, data: { value } }) })
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? String(response.status))
  }

  // A tap on a <pinpoint> picture, as src/components/pinpoint.js reads it:
  // { x, y } from 0 to 1. Whether it is inside the circle, measured in
  // widths so the circle stays round (isInside there).
  const tapOf = value => {
    const x = Number(value?.x), y = Number(value?.y)
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 } : null
  }
  const circleOf = value => ['x', 'y', 'r', 'ratio'].every(key => Number.isFinite(value?.[key])) ? value : null
  const isInside = (tap, circle) => Math.hypot(tap.x - circle.x, (tap.y - circle.y) * circle.ratio) <= circle.r
  const place = ({ x, y }) => `left: ${x * 100}%; top: ${y * 100}%;`
  // The picture comes from this server (rooms/<code>/image), or from another
  // site on https. One element, kept while the page redraws; a picture the
  // server does not hold yet is asked for again a moment later.
  const pictureUrl = image => typeof image?.url !== 'string' ? null : /^https:\/\//.test(image.url) ? image.url : /^rooms\//.test(image.url) ? new URL(image.url, base).href : null
  let picture = null
  const pictureFor = url => {
    if (picture?.url === url) return picture.img
    const img = el('img', { alt: '', draggable: 'false', src: url })
    const own = picture = { url, img }
    img.addEventListener('error', () => setTimeout(() => { if (picture === own) img.src = `${url}${url.includes('?') ? '&' : '?'}again=${Date.now()}` }, 2500))
    return img
  }

  const FORMS = {
    // { question, options, optionsHtml | keys, multiple }: one answer, or with
    // `multiple` several, which can be changed. With `keys` the buttons show
    // A, B… (or 1, 2…) and the options are on the slide.
    choice(activity, room) {
      const several = !!activity.multiple
      const saved = remembered(room)
      let picks = []
      if (several) { try { picks = JSON.parse(saved ?? '[]') } catch {} }
      else if (saved != null) picks = [saved]
      picks = activity.options.filter(option => Array.isArray(picks) && picks.includes(option))
      const vote = async next => {
        try {
          await answer(room, several ? next : next[0])
          remember(room, several ? JSON.stringify(next) : next[0])
          status = ''
        } catch (error) { status = error.message }
        render()
      }
      const solution = controls.revealed && Array.isArray(controls.solution) ? activity.options.filter(option => controls.solution.includes(option)) : null
      const right = solution && (several ? picks.length === solution.length && picks.every(pick => solution.includes(pick)) : solution.includes(picks[0]))
      return [
        el('div', { class: activity.keys ? 'answer-keys' : 'answer-options' }, activity.options.map(option => {
          const on = picks.includes(option)
          return el('button', {
            class: on ? 'is-picked' : null, 'aria-pressed': String(on), disabled: !!controls.closed,
            onclick: () => vote(several ? activity.options.filter(o => o === option ? !on : picks.includes(o)) : [option]),
          }, several && !activity.keys ? el('span', { class: 'answer-check', 'aria-hidden': 'true' }) : null, shown(activity, option))
        })),
        statusLine(picks.length
          ? sentence(several ? words.thanksSeveral : words.thanks, 'choice', listed(picks.map(pick => shown(activity, pick))))
          : several ? words.pickSeveral : words.pick),
        solution?.length ? verdict(picks.length > 0, right, listed(solution.map(option => shown(activity, option)))) : null,
      ]
    },
    // { question, placeholder }: a number, typed; the latest one counts.
    numeric(activity, room) {
      const sent = remembered(room)
      const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'send', placeholder: activity.placeholder || words.number, disabled: !!controls.closed })
      input.value = draft
      input.addEventListener('input', () => { draft = input.value })
      const form = el('form', { class: 'answer-number', onsubmit: async event => {
        event.preventDefault()
        const text = input.value.trim()
        if (parseNumber(text) == null) { status = words.invalid; render(); return }
        try { await answer(room, text); remember(room, text); draft = ''; status = '' } catch (error) { status = error.message }
        render()
      } }, input, el('button', { type: 'submit', disabled: !!controls.closed }, words.send))
      const solution = controls.revealed && controls.solution && Number.isFinite(controls.solution.value) ? controls.solution : null
      const right = solution && sent != null && Math.abs(parseNumber(sent) - solution.value) <= (solution.tolerance ?? 0)
      return [
        form,
        statusLine(sent != null ? fill(words.numberSent, { value: sent }) : ''),
        solution ? verdict(sent != null, right, drawn(solution.html, solution.text)) : null,
      ]
    },
    // { question, image: { url, ratio } }: a tap on the picture puts a pin
    // there, Send sends it; the latest one counts. Once the right answer
    // shows, the circle (`solution`) is drawn and the phone says whether its
    // pin was inside. Without the picture yet, the phone waits for it.
    pin(activity, room) {
      const url = pictureUrl(activity.image)
      if (!url) return [statusLine(words.pinLoading)]
      let sent = null
      try { sent = tapOf(JSON.parse(remembered(room) ?? 'null')) } catch {}
      const pin = pinDraft ?? sent
      const img = pictureFor(url)
      const circle = controls.revealed ? circleOf(controls.solution) : null
      const ratio = Number(activity.image.ratio) > 0 ? Number(activity.image.ratio) : null
      const tap = event => {
        if (controls.closed) return
        const box = img.getBoundingClientRect()
        if (!box.width || !box.height) return
        const clamp = value => Math.min(1, Math.max(0, value))
        pinDraft = tapOf({ x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) })
        status = ''
        render()
      }
      const send = async () => {
        if (!pinDraft) return
        try { await answer(room, pinDraft); remember(room, JSON.stringify(pinDraft)); pinDraft = null; status = '' } catch (error) { status = error.message }
        render()
      }
      return [
        el('div', { class: `answer-picture${controls.closed ? ' is-closed' : ''}`, style: ratio ? `aspect-ratio: 1 / ${ratio};` : null, onclick: tap },
          img,
          circle && el('span', { class: 'answer-pin-target', style: `${place(circle)} width: ${circle.r * 200}%; height: ${(circle.r * 200) / circle.ratio}%;` }),
          pin && el('span', { class: `answer-pin${pinDraft ? ' is-draft' : ''}`, style: place(pin) })),
        el('button', { type: 'button', class: 'answer-send', disabled: !!controls.closed || !pinDraft, onclick: send }, words.send),
        statusLine(pinDraft ? words.pinConfirm : sent ? words.pinSent : words.pinPick),
        circle ? el('p', { class: `answer-verdict${sent ? (isInside(sent, circle) ? ' is-right' : ' is-wrong') : ''}`, role: 'status' }, sent ? (isInside(sent, circle) ? words.right : words.pinWrong) : words.pinSolution) : null,
      ]
    },
    // { question, placeholder, maxLength, once }: short text, as often as
    // people like; with `once` (a word cloud) the latest one counts, and the
    // phone says which it sent.
    text(activity, room) {
      const sent = activity.once ? remembered(room) : null
      const input = el('textarea', { rows: activity.once ? 1 : 3, maxlength: activity.maxLength ?? 200, placeholder: activity.placeholder ?? '', disabled: !!controls.closed })
      input.value = draft
      input.addEventListener('input', () => { draft = input.value })
      const form = el('form', { class: 'answer-text', onsubmit: async event => {
        event.preventDefault()
        const value = input.value.trim()
        if (!value) return
        try {
          await answer(room, value)
          draft = ''
          if (activity.once) { remember(room, value); status = '' } else status = words.sent
        } catch (error) { status = error.message }
        render()
      } }, input, el('button', { type: 'submit', disabled: !!controls.closed }, words.send))
      return [form, statusLine(sent != null ? fill(words.numberSent, { value: sent }) : '')]
    },
    // { question, min, max, minLabel, maxLabel }: a number on a scale.
    scale(activity, room) {
      const picked = remembered(room)
      const steps = []
      for (let n = activity.min ?? 1; n <= (activity.max ?? 5); n++) steps.push(String(n))
      return [
        el('div', { class: 'answer-scale' }, steps.map(step => el('button', {
          class: step === picked ? 'is-picked' : null, 'aria-pressed': String(step === picked), disabled: !!controls.closed,
          onclick: async () => {
            try { await answer(room, Number(step)); remember(room, step); status = '' } catch (error) { status = error.message }
            render()
          },
        }, step))),
        (activity.minLabel || activity.maxLabel) && el('div', { class: 'answer-scale-labels' }, el('span', {}, drawn(activity.minLabelHtml, activity.minLabel ?? '')), el('span', {}, drawn(activity.maxLabelHtml, activity.maxLabel ?? ''))),
        statusLine(picked ? fill(words.thanks, { choice: picked }) : words.pick),
      ]
    },
  }

  // Reactions (src/core/reactions.js): a row of buttons whenever the deck
  // offers them; a tap floats up on the presenter's screen. One tap a
  // second at most, so a thumb on a button is not a flood.
  const REACT_MS = 1000
  let reactedAt = 0
  async function react(value, button) {
    const now = Date.now()
    if (now - reactedAt < REACT_MS) return
    reactedAt = now
    button.classList.remove('is-sent')
    void button.offsetWidth
    button.classList.add('is-sent')
    try {
      await fetch(new URL(`rooms/${encodeURIComponent(`${code}.reactions`)}`, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: me, data: { value } }) })
    } catch {}
  }
  const reactions = list => el('nav', { class: 'answer-reactions', 'aria-label': words.react ?? 'React' },
    list.map(value => el('button', { type: 'button', 'aria-label': value, onclick: event => react(value, event.currentTarget) }, value)))

  function render() {
    const activity = current?.activity
    const form = activity && FORMS[activity.type]
    // Without the filter, replaceChildren() writes a missing part out as "null".
    root.replaceChildren(...[
      form
        ? el('main', { class: 'answer' }, activity.question && el('h1', {}, drawn(activity.questionHtml, activity.question)), form(activity, current.room))
        : el('main', { class: 'answer answer--waiting' }, el('p', {}, connected ? words.waiting : words.offline)),
      connected && Array.isArray(current?.reactions) && current.reactions.length ? reactions(current.reactions.filter(value => typeof value === 'string').slice(0, 8)) : null,
      current?.title ? el('footer', {}, current.title) : null,
      // The presenter's screen sends the link when other devices can follow the slides.
      /^https?:\/\//.test(current?.follow ?? '') ? el('a', { class: 'answer-follow', href: current.follow }, words.follow ?? 'Follow the slides') : null,
    ].filter(Boolean))
  }

  function follow(state) {
    const previous = current?.room
    current = state
    if (state?.labels) words = { ...words, ...state.labels }
    applyLook(state?.look, state?.lang)
    if (state?.room !== previous) { status = ''; draft = ''; pinDraft = null }
    followControls(state?.activity ? state.room : null)
    render()
  }

  render()
  // view=phone: the presenter sees how many phones are connected.
  const source = new EventSource(new URL(`rooms/${encodeURIComponent(code)}/events?view=phone&device=phone`, base))
  source.addEventListener('snapshot', event => { connected = true; follow(JSON.parse(event.data).state) })
  source.addEventListener('error', () => { connected = false; render() })
  source.addEventListener('state', event => follow(JSON.parse(event.data).state))
})()
