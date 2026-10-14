// Rooms for audience interaction. A room is a list of small messages that
// phones post and slides follow live; the server never interprets them, so a
// new kind of activity (poll, word cloud, questions) needs no server change.
// A room also has one state value that only the presenter sets: the deck's
// session room holds the activity on screen, which the answer page shows.
// Everything lives in memory: nothing is written to disk, and idle rooms are
// forgotten. The same handler runs inside `mdeck run` and as `mdeck server`.
import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CODE_RE } from './code.js'

// This mdeck's version, in /info: a presenter on a newer mdeck can tell that
// this server lacks what its deck uses (src/build/homePlugin.js).
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

// The phones' answer page, served by the server itself at /<code>.
const ANSWER_FILES = Object.fromEntries(['answer.html', 'answer.js', 'answer.css'].map(name => [name, readFileSync(new URL(`./answer/${name}`, import.meta.url))]))
const ANSWER_TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' }

export const ROOM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
// A session's reactions room: `<code>.reactions`.
const isReactionRoom = id => id.endsWith('.reactions')
// What a connected window may say it is, for the presenter's overview of
// who is connected (src/components/ConnectedViews.jsx); phones only count.
export const VIEWS = ['presenter', 'audience', 'deck', 'phone']
export const DEVICES = ['computer', 'ipad', 'tablet', 'phone']
const HOUR = 60 * 60 * 1000

// Screens repeat their state every 4 s (src/live/client.js); one silent for
// longer has closed, such as a talk given earlier on this server.
const QUIET_MS = 15000

// `onState(id, state)` hears each change of a room's state.
export function createRooms({ maxMessages = 5000, maxInk = 5000, maxRooms = 500, idleMs = 12 * HOUR, now = Date.now, quietMs = QUIET_MS, onState = null } = {}) {
  const rooms = new Map()
  const prune = () => { for (const [id, room] of rooms) if (!room.listeners.size && now() - room.touched > idleMs) rooms.delete(id) }
  const get = id => {
    let room = rooms.get(id)
    if (!room) {
      if (rooms.size >= maxRooms) prune()
      if (rooms.size >= maxRooms) throw Object.assign(new Error('Too many rooms are open on this server'), { status: 503 })
      room = { messages: [], state: null, stamp: 0, heard: 0, screens: new Map(), ink: [], listeners: new Set(), present: new Map(), next: 1, touched: now() }
      rooms.set(id, room)
    }
    room.touched = now()
    return room
  }
  const broadcast = (room, event) => { for (const listener of room.listeners) listener(event) }
  // A session is a room and the rooms named after it (`<code>.stage`, …).
  const sessionRooms = id => { const session = id.split('.')[0]; return [...rooms].filter(([name]) => name === session || name.startsWith(`${session}.`)).map(([, room]) => room) }
  // Phones connected elsewhere, by session: mdeck run keeps the stage room
  // here but the phones join a standalone server (src/live/server.js).
  const awayPhones = new Map()
  const presence = id => {
    const present = sessionRooms(id).flatMap(room => [...room.present.values()])
    const views = present.filter(entry => entry.view !== 'phone').sort((a, b) => VIEWS.indexOf(a.view) - VIEWS.indexOf(b.view))
    return { views, phones: present.length - views.length + (awayPhones.get(id.split('.')[0]) ?? 0) }
  }
  const announcePresence = id => { const event = { type: 'presence', presence: presence(id) }; for (const room of sessionRooms(id)) broadcast(room, event) }
  return {
    /** Phones of session `id` that joined another server; announced when the number changes. */
    setAwayPhones(id, n) {
      const session = id.split('.')[0]
      if ((awayPhones.get(session) ?? 0) === n) return
      awayPhones.set(session, n)
      announcePresence(session)
    },
    post(id, { from = null, data }) {
      const room = get(id)
      // Reactions (src/core/reactions.js) are passed on and forgotten.
      const keep = !isReactionRoom(id)
      if (keep && room.messages.length >= maxMessages) throw Object.assign(new Error('This room is full'), { status: 429 })
      const message = { n: room.next++, at: new Date(now()).toISOString(), from, data }
      if (keep) room.messages.push(message)
      broadcast(room, { type: 'message', message })
      return message
    },
    reset(id) {
      const room = get(id)
      room.messages = []
      broadcast(room, { type: 'reset' })
    },
    // A state carries `at`, when its screen last changed it. The latest change
    // wins: a state older than the current one is ignored (returns false), so
    // a forgotten screen repeating an old slide cannot take the phones back.
    // States that name their `screen` are ordered by when this server first
    // heard of the change, not by the clocks of the devices (an iPad and a
    // laptop rarely agree to the second); a screen that just opened says
    // `at: 0` and is the oldest. A state whose screen stopped repeating it
    // holds nothing back: a talk that ended does not keep the phones from
    // the next presenter view. Only the activity rooms' states are repeated;
    // the stage room hears of a change once (src/runtime/ink/room.js), so a
    // presenter who stays on a slide is not quiet there, and a window that
    // opens on another device must not take the slide from it.
    setState(id, state) {
      const room = get(id)
      const next = state ?? null
      const at = Number.isFinite(next?.at) ? next.at : 0
      let stamp = at
      if (typeof next?.screen === 'string' && at) {
        const seen = room.screens.get(next.screen)
        stamp = seen?.at === at ? seen.stamp : Math.max(now(), room.stamp + 1)
        room.screens.delete(next.screen)
        room.screens.set(next.screen, { at, stamp })
        if (room.screens.size > 50) room.screens.delete(room.screens.keys().next().value)
      }
      // A state without `at`, as from an outdated page, counts as the oldest.
      if (next && room.state && stamp < room.stamp && (id.endsWith('.stage') || now() - room.heard < quietMs)) return false
      room.stamp = next ? stamp : 0
      room.heard = now()
      // The presenter repeats its state; listeners only hear changes.
      if (JSON.stringify(next) === JSON.stringify(room.state)) return true
      room.state = next
      broadcast(room, { type: 'state', state: room.state })
      onState?.(id, next)
      return true
    },
    // Live ink (src/runtime/ink/bus.js): passed on at once and not kept,
    // except the changes of the saved ink, which a screen that opens later
    // gets with the snapshot. Returns how many listen.
    relayInk(id, messages) {
      const room = get(id)
      const changes = messages.filter(message => message?.type === 'op')
      if (changes.length) room.ink = [...room.ink, ...changes].slice(-maxInk)
      broadcast(room, { type: 'ink', messages })
      return room.listeners.size
    },
    ink: id => get(id).ink,
    snapshot: id => get(id).messages,
    state: id => get(id).state,
    presence: id => { get(id); return presence(id) },
    // A listener that says what it is ({ view, device }) counts in the
    // session's presence; every change reaches all of the session's rooms.
    subscribe(id, listener, present = null) {
      const room = get(id)
      room.listeners.add(listener)
      if (present) { room.present.set(listener, present); announcePresence(id) }
      return () => {
        room.listeners.delete(listener)
        room.touched = now()
        if (room.present.delete(listener)) announcePresence(id)
      }
    },
    get size() { return rooms.size },
  }
}

// Per-address token bucket: `burst` messages at once, refilled over `perMs`.
export function createLimiter({ burst = 30, perMs = 10000, now = Date.now } = {}) {
  const buckets = new Map()
  return key => {
    const t = now()
    const bucket = buckets.get(key) ?? { tokens: burst, at: t }
    bucket.tokens = Math.min(burst, bucket.tokens + ((t - bucket.at) / perMs) * burst)
    bucket.at = t
    buckets.set(key, bucket)
    if (buckets.size > 10000) for (const [k, b] of buckets) if (b.tokens >= burst) buckets.delete(k)
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export const isLoopbackAddress = address => LOOPBACK.has(address)

// Behind a proxy on the same machine (nginx), the client is the forwarded one.
export function clientAddress(request) {
  const direct = request.socket?.remoteAddress ?? ''
  const forwarded = request.headers['x-forwarded-for']
  return isLoopbackAddress(direct) && forwarded ? forwarded.split(',')[0].trim() : direct
}

export function keyMatches(request, key) {
  if (!key) return false
  const given = Buffer.from((request.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))
  const wanted = Buffer.from(key)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

const MAX_BODY = 4096
const MAX_STATE = 32768
const MAX_INK = 65536

function readBody(request, limit = MAX_BODY) {
  return new Promise((done, fail) => {
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) return fail(Object.assign(new Error('Send JSON'), { status: 415 }))
    let size = 0
    const chunks = []
    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) { request.pause(); fail(Object.assign(new Error('Message too large'), { status: 413, close: true })); return }
      chunks.push(chunk)
    })
    request.on('end', () => { try { done(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { fail(Object.assign(new Error('Not valid JSON'), { status: 400 })) } })
    request.on('error', fail)
  })
}

function reply(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(text)
}

// Routes, relative to where the handler is mounted:
//   GET  /<code>               the phones' answer page (and answer.js, answer.css)
//   GET  /info                 { canReset, ...extra }
//   GET  /rooms/<id>/events    Server-Sent Events: snapshot, message, reset, state;
//                              ?view=…&device=… counts this window as connected,
//                              ?presence=1 adds who is connected to the session
//                              ?only=state sends the room's state alone
//   GET  /rooms/<id>/presence  who is connected to the session, once
//   POST /rooms/<id>           { from, data } → { n }; in <code>.reactions
//                              passed on without being kept
//   POST /rooms/<id>/reset     presenter only
//   POST /rooms/<id>/state     { state } — presenter only
//   POST /rooms/<id>/ink       { messages } — presenter only, live ink
// Answers carry no cookies and no personal data, so any page may use them.
export function liveHandler({ rooms = createRooms(), canReset = () => false, info = () => ({}), limit = createLimiter(), inkLimit = createLimiter({ burst: 60, perMs: 3000 }), reactionLimit = createLimiter({ burst: 120, perMs: 10000 }), heartbeatMs = 20000 } = {}) {
  return async (request, response, next = () => reply(response, 404, { error: 'Not found' })) => {
    const { pathname, searchParams } = new URL(request.url, 'http://localhost')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    try {
      if (pathname === '/info' && request.method === 'GET') return reply(response, 200, { canReset: !!canReset(request, searchParams.get('session')), version: VERSION, ...info(request) })
      const page = pathname.slice(1)
      if (request.method === 'GET' && (CODE_RE.test(page) || Object.hasOwn(ANSWER_FILES, page))) {
        const name = CODE_RE.test(page) ? 'answer.html' : page
        response.writeHead(200, { 'Content-Type': ANSWER_TYPES[name.split('.').pop()], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
        return response.end(ANSWER_FILES[name])
      }
      const match = pathname.match(/^\/rooms\/([^/]+)(\/events|\/presence|\/reset|\/state|\/ink)?$/)
      if (!match) return next()
      const id = decodeURIComponent(match[1])
      if (!ROOM_RE.test(id)) return reply(response, 400, { error: 'Room names use letters, digits, dots, hyphens and underscores' })
      if (match[2] === '/events' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' })
        const write = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        const ink = rooms.ink(id)
        const view = searchParams.get('view'), device = searchParams.get('device')
        const present = VIEWS.includes(view) ? { view, device: DEVICES.includes(device) ? device : 'computer' } : null
        const wantsPresence = searchParams.get('presence') === '1'
        // ?only=state: the room's state alone, as phones follow an activity's
        // controls (closed, the right answer) without everyone's answers.
        const onlyState = searchParams.get('only') === 'state'
        write('snapshot', { messages: onlyState ? [] : rooms.snapshot(id), state: rooms.state(id), ...(ink.length ? { ink } : {}), ...(wantsPresence ? { presence: rooms.presence(id) } : {}) })
        const unsubscribe = rooms.subscribe(id, event => {
          if (event.type === 'presence') { if (wantsPresence) write('presence', event.presence); return }
          if (onlyState && event.type !== 'state') return
          write(event.type, event.type === 'message' ? event.message : event.type === 'state' ? { state: event.state } : event.type === 'ink' ? { messages: event.messages } : {})
        }, present)
        const beat = setInterval(() => response.write(': ping\n\n'), heartbeatMs)
        request.on('close', () => { clearInterval(beat); unsubscribe() })
        return
      }
      if (match[2] === '/presence' && request.method === 'GET') return reply(response, 200, rooms.presence(id))
      if (request.method !== 'POST') return reply(response, 405, { error: 'Method not allowed' })
      if (match[2] === '/ink') {
        if (!canReset(request, id)) return reply(response, 403, { error: 'Only the presenter can draw' })
        if (!inkLimit(clientAddress(request))) return reply(response, 429, { error: 'Too much ink at once' })
        const { messages } = await readBody(request, MAX_INK)
        if (!Array.isArray(messages) || messages.length > 100) return reply(response, 400, { error: 'Send { messages: [...] }' })
        return reply(response, 200, { ok: true, listeners: rooms.relayInk(id, messages) })
      }
      if (match[2] === '/reset' || match[2] === '/state') {
        if (!canReset(request, id)) return reply(response, 403, { error: 'Only the presenter can change a room' })
        if (match[2] === '/reset') rooms.reset(id)
        else if (!rooms.setState(id, (await readBody(request, MAX_STATE)).state)) return reply(response, 200, { ok: true, ignored: true })
        return reply(response, 200, { ok: true })
      }
      // Reactions have a limit of their own: a room behind one address (a
      // lecture hall's network) must not use up its answers with them.
      if (!(isReactionRoom(id) ? reactionLimit : limit)(clientAddress(request))) return reply(response, 429, { error: 'Too many answers at once; wait a moment' })
      const body = await readBody(request)
      if (isReactionRoom(id) && (typeof body.data?.value !== 'string' || body.data.value.length > 16)) return reply(response, 400, { error: 'A reaction is a short text' })
      if (!('data' in body)) return reply(response, 400, { error: 'Send { data }' })
      const from = typeof body.from === 'string' ? body.from.slice(0, 64) : null
      return reply(response, 201, { n: rooms.post(id, { from, data: body.data }).n })
    } catch (error) {
      // An oversized body is not read to the end; answer, then drop the connection.
      if (error.close) { response.setHeader('Connection', 'close'); response.on('finish', () => request.destroy()) }
      if (!response.headersSent) reply(response, error.status ?? 500, { error: error.message })
    }
  }
}
