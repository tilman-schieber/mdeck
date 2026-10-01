// The phone page the room server serves at <server>/<code>. It needs no deck:
// the presenter's screen sends the activity on screen (what to ask and how to
// answer), the deck's look and the words in the deck's language, and this page
// shows them. Plain browser JavaScript, no build step.
(() => {
  const base = new URL('.', location.href)
  const code = location.pathname.split('/').filter(Boolean).pop()
  const root = document.getElementById('answer')
  const FALLBACK = {
    en: { waiting: 'The next question will appear here.', pick: 'Tap one answer.', thanks: 'Thanks! You chose “{choice}”. Tap another to change.', send: 'Send', sent: 'Sent. Thank you!', offline: 'Connecting…' },
    de: { waiting: 'Die nächste Frage erscheint hier.', pick: 'Eine Antwort antippen.', thanks: 'Danke! Gewählt: „{choice}“. Zum Ändern eine andere antippen.', send: 'Senden', sent: 'Gesendet. Danke!', offline: 'Verbinde…' },
  }
  let words = FALLBACK[navigator.language?.slice(0, 2) === 'de' ? 'de' : 'en']
  let current = null
  let connected = false
  let status = ''

  const me = (() => {
    try {
      let id = localStorage.getItem('mdeck-live-client')
      // randomUUID only exists on https or localhost, not at `mdeck dev --host`'s http://192.168…
      if (!id) localStorage.setItem('mdeck-live-client', id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''))
      return id
    } catch { return String(Math.random()).slice(2) }
  })()
  const chosenKey = room => `mdeck-answer:${code}.${room}`
  const remembered = room => { try { return localStorage.getItem(chosenKey(room)) } catch { return null } }
  const remember = (room, value) => { try { localStorage.setItem(chosenKey(room), value) } catch {} }
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (all, name) => vars[name] ?? all)
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
      else if (value != null && value !== false) node.setAttribute(key, value === true ? '' : value)
    }
    node.append(...children.flat().filter(child => child != null))
    return node
  }

  // The deck's colours and fonts, as the presenter's screen shows them.
  function applyLook(look, lang) {
    if (lang) document.documentElement.lang = lang
    // No look: keep the one the page has, fonts included.
    if (!look?.tokens) return
    const style = document.documentElement.style
    for (const [name, value] of Object.entries(look?.tokens ?? {})) if (/^--[\w-]+$/.test(name)) style.setProperty(name, value)
    for (const [name, value] of Object.entries(look?.heading ?? {})) style.setProperty(`--answer-heading-${name}`, value)
    const wanted = (look?.fonts ?? []).filter(url => /^https:\/\//.test(url))
    for (const link of [...document.querySelectorAll('link[data-theme-font]')]) if (!wanted.includes(link.href)) link.remove()
    for (const url of wanted) if (!document.querySelector(`link[data-theme-font][href="${CSS.escape(url)}"]`)) document.head.append(el('link', { rel: 'stylesheet', href: url, 'data-theme-font': true }))
  }

  async function answer(room, value) {
    const response = await fetch(new URL(`rooms/${encodeURIComponent(`${code}.${room}`)}`, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: me, data: { value } }) })
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? String(response.status))
  }

  const FORMS = {
    // { question, options: [..] }: one of several answers, which can be changed.
    choice(activity, room) {
      const picked = remembered(room)
      return [
        el('div', { class: 'answer-options' }, activity.options.map(option => el('button', {
          class: option === picked ? 'is-picked' : null, 'aria-pressed': String(option === picked),
          onclick: async () => {
            try { await answer(room, option); remember(room, option); status = fill(words.thanks, { choice: option }) } catch (error) { status = error.message }
            render()
          },
        }, option))),
        el('p', { class: 'answer-status', role: 'status' }, status || (picked ? fill(words.thanks, { choice: picked }) : words.pick)),
      ]
    },
    // { question, placeholder, maxLength }: short text, as often as people like.
    text(activity, room) {
      const input = el('textarea', { rows: 3, maxlength: activity.maxLength ?? 200, placeholder: activity.placeholder ?? '' })
      const form = el('form', { class: 'answer-text', onsubmit: async event => {
        event.preventDefault()
        const value = input.value.trim()
        if (!value) return
        try { await answer(room, value); status = words.sent } catch (error) { status = error.message }
        render()
      } }, input, el('button', { type: 'submit' }, words.send))
      return [form, el('p', { class: 'answer-status', role: 'status' }, status)]
    },
    // { question, min, max, minLabel, maxLabel }: a number on a scale.
    scale(activity, room) {
      const picked = remembered(room)
      const steps = []
      for (let n = activity.min ?? 1; n <= (activity.max ?? 5); n++) steps.push(String(n))
      return [
        el('div', { class: 'answer-scale' }, steps.map(step => el('button', {
          class: step === picked ? 'is-picked' : null, 'aria-pressed': String(step === picked),
          onclick: async () => {
            try { await answer(room, Number(step)); remember(room, step); status = fill(words.thanks, { choice: step }) } catch (error) { status = error.message }
            render()
          },
        }, step))),
        (activity.minLabel || activity.maxLabel) && el('div', { class: 'answer-scale-labels' }, el('span', {}, activity.minLabel ?? ''), el('span', {}, activity.maxLabel ?? '')),
        el('p', { class: 'answer-status', role: 'status' }, status || (picked ? fill(words.thanks, { choice: picked }) : words.pick)),
      ]
    },
  }

  function render() {
    const activity = current?.activity
    const form = activity && FORMS[activity.type]
    root.replaceChildren(
      form
        ? el('main', { class: 'answer' }, activity.question && el('h1', {}, activity.question), form(activity, current.room))
        : el('main', { class: 'answer answer--waiting' }, el('p', {}, connected ? words.waiting : words.offline)),
      current?.title ? el('footer', {}, current.title) : null,
    )
  }

  function follow(state) {
    const previous = current?.room
    current = state
    if (state?.labels) words = { ...words, ...state.labels }
    applyLook(state?.look, state?.lang)
    if (state?.room !== previous) status = ''
    render()
  }

  render()
  const source = new EventSource(new URL(`rooms/${encodeURIComponent(code)}/events`, base))
  source.addEventListener('snapshot', event => { connected = true; follow(JSON.parse(event.data).state) })
  source.addEventListener('error', () => { connected = false; render() })
  source.addEventListener('state', event => follow(JSON.parse(event.data).state))
})()
