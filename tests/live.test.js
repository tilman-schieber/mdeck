import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRooms, createLimiter, clientAddress, liveHandler } from '../src/live/rooms.js'
import { startLiveServer } from '../src/live/server.js'
import { findRoomTag, roomsIn, roomsOnSlide, slideTitleFor } from '../src/live/roomTag.js'
import { sessionCode } from '../src/live/code.js'
import { parseSlides } from '../src/core/parseSlides.js'
import { validateDeck } from '../src/core/validateDeck.js'

const live = await startLiveServer({ port: 0, key: 'secret' })
after(() => live.close())
const post = (room, body, headers = {}) => fetch(`${live.url}/rooms/${room}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

// Reads Server-Sent Events until `count` events arrived.
async function events(room, count, during = async () => {}, query = '') {
  const controller = new AbortController()
  const response = await fetch(`${live.url}/rooms/${room}/events${query}`, { signal: controller.signal })
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const seen = []
  let buffer = '', started = false
  while (seen.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2)
      const type = block.match(/^event: (.+)$/m)?.[1]
      if (type) seen.push({ type, data: JSON.parse(block.match(/^data: (.*)$/m)[1]) })
    }
    if (!started && seen.length) { started = true; await during() }
  }
  controller.abort()
  return seen
}

test('phones post, slides get a snapshot and then each new message', async () => {
  assert.equal((await post('deck.lunch', { from: 'phone-1', data: { vote: 'Thai' } })).status, 201)
  const seen = await events('deck.lunch', 3, async () => {
    await post('deck.lunch', { from: 'phone-2', data: { vote: 'Pizza' } })
    await post('deck.lunch', { from: 'phone-1', data: { vote: 'Mensa' } })
  })
  assert.equal(seen[0].type, 'snapshot')
  assert.deepEqual(seen[0].data.messages.map(m => m.data.vote), ['Thai'])
  assert.deepEqual(seen.slice(1).map(e => [e.type, e.data.data.vote]), [['message', 'Pizza'], ['message', 'Mensa']])
  const first = seen[0].data.messages[0].n
  assert.deepEqual(seen.slice(1).map(e => e.data.n), [first + 1, first + 2])
  // A phone's id never shows on the open stream, but its answers stay its own.
  const [thai, pizza, mensa] = [seen[0].data.messages[0], seen[1].data, seen[2].data]
  assert.equal(thai.from, mensa.from)
  assert.notEqual(thai.from, pizza.from)
  assert.ok(![thai.from, pizza.from].some(from => /phone/.test(from)))
})

test('message numbers of a server that restarted stay above those given before', () => {
  let t = 1_700_000_000_000
  const before = createRooms({ now: () => t })
  for (let i = 0; i < 100; i++) before.post('a', { data: i })
  const last = before.snapshot('a').at(-1).n
  t += 1000
  const after = createRooms({ now: () => t })
  assert.ok(after.post('a', { data: 'new' }).n > last, 'a closed poll stays closed to new answers')
  assert.equal(createRooms({ now: () => 0 }).post('a', { data: 1 }).n, 1)
})

test('only the key holder can reset a room, and listeners hear it', async () => {
  await post('deck.reset', { data: 1 })
  assert.equal((await fetch(`${live.url}/rooms/deck.reset/reset`, { method: 'POST' })).status, 403)
  assert.equal((await fetch(`${live.url}/rooms/deck.reset/reset`, { method: 'POST', headers: { Authorization: 'Bearer wrong!' } })).status, 403)
  const seen = await events('deck.reset', 2, () => fetch(`${live.url}/rooms/deck.reset/reset`, { method: 'POST', headers: { Authorization: 'Bearer secret' } }))
  assert.deepEqual(seen.map(e => e.type), ['snapshot', 'reset'])
  assert.deepEqual((await events('deck.reset', 1))[0].data.messages, [])
  // Phones follow the state alone, but hear a reset: they forget their answer.
  const phone = await events('deck.reset', 2, async () => {
    await post('deck.reset', { data: 2 })
    await fetch(`${live.url}/rooms/deck.reset/reset`, { method: 'POST', headers: { Authorization: 'Bearer secret' } })
  }, '?only=state')
  assert.deepEqual(phone.map(e => e.type), ['snapshot', 'reset'])
  assert.equal((await (await fetch(`${live.url}/info`, { headers: { Authorization: 'Bearer secret' } })).json()).canReset, true)
  assert.equal((await (await fetch(`${live.url}/info`)).json()).canReset, false)
})

test('only the presenter sets a room state, and listeners follow it', async () => {
  const set = (state, headers = {}) => fetch(`${live.url}/rooms/deck/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ state }) })
  assert.equal((await set({ room: 'evil' })).status, 403)
  assert.equal((await events('deck', 1))[0].data.state, null)
  const seen = await events('deck', 3, async () => {
    await set({ room: 'lunch' }, { Authorization: 'Bearer secret' })
    await set({ room: 'lunch' }, { Authorization: 'Bearer secret' })
    await set({ room: null }, { Authorization: 'Bearer secret' })
  })
  assert.deepEqual(seen.map(e => [e.type, e.data.state?.room ?? null]), [['snapshot', null], ['state', 'lunch'], ['state', null]], 'a repeated state is not passed on again')
  assert.deepEqual((await events('deck', 1))[0].data.state, { room: null })
})

test('bad requests are refused', async () => {
  assert.equal((await post('bad%20room', { data: 1 })).status, 400)
  assert.equal((await post('deck.x', { nothing: true })).status, 400)
  assert.equal((await post('deck.x', { data: 'x'.repeat(5000) })).status, 413)
  assert.equal((await fetch(`${live.url}/rooms/deck.x`, { method: 'POST', body: 'hi' })).status, 415)
  assert.equal((await fetch(`${live.url}/nope`)).status, 404)
  const preflight = await fetch(`${live.url}/rooms/deck.x`, { method: 'OPTIONS' })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
})

test('the latest change wins over repeats from a screen changed earlier', () => {
  const rooms = createRooms()
  const heard = []
  rooms.subscribe('s', event => heard.push(event.state?.room))
  assert.equal(rooms.setState('s', { room: 'a', at: 0 }), true, 'a screen that just opened')
  assert.equal(rooms.setState('s', { room: 'b', at: 200 }), true, 'the presenter moves on')
  assert.equal(rooms.setState('s', { room: null, at: 100 }), false, 'a forgotten screen repeating an older slide')
  assert.equal(rooms.setState('s', { room: 'a', at: 0 }), false, 'a newly opened screen')
  assert.equal(rooms.setState('s', { room: 'b', at: 200 }), true, 'the presenter repeating itself')
  assert.equal(rooms.setState('s', { room: 'old' }), false, 'a page without `at` counts as the oldest')
  assert.equal(rooms.setState('s', { room: null, at: 300 }), true, 'someone moves the other screen on')
  assert.deepEqual(heard, ['a', 'b', null])
  assert.deepEqual(rooms.state('s'), { room: null, at: 300 })
})

test('a screen turned away on the activity the phones follow is told it agrees', async t => {
  const url = await smallServer(t, { canReset: () => true })
  const send = state => fetch(`${url}/rooms/talk/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) }).then(response => response.json())
  const poll = { type: 'choice', options: ['A', 'B'] }
  assert.deepEqual(await send({ room: 'q', activity: poll, at: 100, screen: 'phone' }), { ok: true })
  assert.deepEqual(await send({ room: 'q', activity: poll, at: 200, screen: 'computer' }), { ok: true }, 'the computer follows the phone clicker')
  assert.deepEqual(await send({ room: 'q', activity: poll, at: 100, screen: 'phone', look: 'other' }), { ok: true, ignored: true, same: true }, 'the phone repeats the same slide')
  assert.deepEqual(await send({ room: null, at: 0, screen: 'tab' }), { ok: true, ignored: true }, 'a newly opened tab on another slide')
})

test('rooms fill up, idle rooms are forgotten and senders are rate limited', () => {
  let t = 0
  const rooms = createRooms({ maxMessages: 2, maxRooms: 1, idleMs: 100, now: () => t })
  rooms.post('a', { data: 1 }); rooms.post('a', { data: 2 })
  assert.throws(() => rooms.post('a', { data: 3 }), { status: 429 })
  assert.throws(() => rooms.post('b', { data: 1 }), { status: 503 })
  t = 1000
  rooms.post('b', { data: 1 })
  assert.equal(rooms.size, 1)
  const limit = createLimiter({ burst: 2, perMs: 1000, now: () => t })
  assert.deepEqual([limit('x'), limit('x'), limit('x'), limit('y')], [true, true, false, true])
  t += 500
  assert.equal(limit('x'), true)
  assert.equal(clientAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }), '203.0.113.9')
  assert.equal(clientAddress({ socket: { remoteAddress: '198.51.100.2' }, headers: { 'x-forwarded-for': '203.0.113.9' } }), '198.51.100.2')
})

// A server of its own, with small limits.
async function smallServer(t, options) {
  const server = createServer(liveHandler(options))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => { server.closeAllConnections(); server.close() })
  return `http://127.0.0.1:${server.address().port}`
}

test('phones behind one address are limited one by one, with a backstop for the address', async t => {
  const url = await smallServer(t, { limit: createLimiter({ burst: 2, perMs: 60000 }), addressLimit: createLimiter({ burst: 5, perMs: 60000 }) })
  const send = from => fetch(`${url}/rooms/hall.q`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, data: { value: 'A' } }) }).then(response => response.status)
  assert.deepEqual([await send('a'), await send('a'), await send('a')], [201, 201, 429], 'one phone, twice')
  assert.deepEqual([await send('b'), await send('c')], [201, 201], 'the next phones still answer')
  assert.equal(await send('d'), 429, 'the address as a whole')
})

test('a full server refuses a new stream with a 503 and forgets rooms that only listeners opened', async t => {
  const rooms = createRooms({ maxRooms: 2 })
  const url = await smallServer(t, { rooms })
  const open = []
  const connect = async room => { const controller = new AbortController(); open.push(controller); const response = await fetch(`${url}/rooms/${room}/events`, { signal: controller.signal }); return response }
  t.after(() => { for (const controller of open) controller.abort() })
  rooms.post('spoken', { data: 1 })
  const listened = await connect('listened')
  assert.equal(listened.status, 200)
  assert.equal(rooms.size, 2)
  // The third room takes the place of the one that holds nothing: its stream
  // ends, and the browser would open it again.
  assert.equal((await connect('third')).status, 200)
  assert.equal(rooms.size, 2)
  assert.match(await Promise.race([listened.text(), new Promise((_, fail) => setTimeout(() => fail(new Error('the stream did not end')), 2000))]), /snapshot/)
  assert.equal(rooms.snapshot('spoken').length, 1, 'a room with answers stays')
  // With every room holding something, the next is refused before the stream starts.
  rooms.post('third', { data: 1 })
  const refused = await connect('fourth')
  assert.equal(refused.status, 503)
  assert.match(refused.headers.get('content-type'), /json/)
})

test('the answer page finds the component by its room', () => {
  const source = '# Q\n\n<poll room="lunch" question="Where?" options="A|B" />\n\n<quiz room=\'q1\'>What is 2+2?</quiz>\n'
  assert.equal(findRoomTag(source, 'lunch'), '<poll room="lunch" question="Where?" options="A|B" />')
  assert.equal(findRoomTag(source, 'q1'), "<quiz room='q1'>What is 2+2?</quiz>")
  assert.equal(findRoomTag(source, 'lun'), null)
  assert.equal(findRoomTag(source, 'a.b'), null)
  assert.deepEqual(roomsIn(source), [{ tag: 'poll', room: 'lunch' }, { tag: 'quiz', room: 'q1' }])
  const deck = parseSlides('---\ntheme: neue\n---\n\n---\ntitle: Outline name\n---\n# On screen\n\n<poll room="a" options="x|y" />\n\n---\n# Plain\n')
  assert.deepEqual(deck.slides.map(roomsOnSlide), [['a'], []])
  assert.equal(slideTitleFor(deck, 'a'), 'On screen', 'phones see the heading the audience saw')
  const shown = '# Syntax\n\n```markdown\n<poll room="a" options="x|y" />\n```\n\nOr inline: `<poll room="b" />`\n\n<poll room="a" options="real|one" />\n'
  assert.deepEqual(roomsIn(shown), [{ tag: 'poll', room: 'a' }], 'code is not an activity')
  assert.equal(findRoomTag(shown, 'a'), '<poll room="a" options="real|one" />')
})

test('server and session settings are validated', () => {
  const codes = config => validateDeck(parseSlides(`---\n${config}\n---\n\n---\n# A\n`)).map(d => d.code)
  assert.deepEqual(codes('server: https://example.org\nsession:\n  id: talk\n  code: 482113'), [])
  assert.deepEqual(codes('server: example.org'), ['invalid-config'])
  assert.deepEqual(codes('session:\n  code: 12'), ['invalid-config'])
  assert.deepEqual(codes('session: yes'), ['invalid-config'])
  assert.deepEqual(codes('live:\n  server: https://example.org/live'), ['renamed-setting'], 'the old name says what replaces it')
})

test("a deck's session code is six stable digits, unless it sets one", () => {
  const a = sessionCode({ meta: { title: 'Ask the room' } })
  assert.match(a, /^[1-9]\d{5}$/)
  assert.equal(sessionCode({ meta: { title: 'Ask the room' } }), a)
  assert.equal(sessionCode({ meta: { title: 'Ask the room' }, session: { id: 'ask-the-room' } }), a, 'session.id and the title give the same name')
  assert.notEqual(sessionCode({ meta: { title: 'Another talk' } }), a)
  assert.equal(sessionCode({ session: { code: 4711 } }), '4711')
})

test("the server serves the phones' answer page at /<code>", async () => {
  const pageResponse = await fetch(`${live.url}/482113`)
  assert.equal(pageResponse.status, 200)
  assert.match(pageResponse.headers.get('content-type'), /text\/html/)
  const html = await pageResponse.text()
  assert.match(html, /answer\.js/)
  for (const [file, type] of [['answer.js', /javascript/], ['answer.css', /css/]]) {
    const response = await fetch(`${live.url}/${file}`)
    assert.equal(response.status, 200, file)
    assert.match(response.headers.get('content-type'), type)
  }
  assert.equal((await fetch(`${live.url}/12`)).status, 404, 'too short to be a code')
})

test("the presenter's state may carry a whole activity and look", async () => {
  const state = { room: 'q', activity: { type: 'choice', question: 'Q?', options: Array.from({ length: 20 }, (_, i) => `Option ${i}`) }, look: { tokens: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`--t${i}`, 'x'.repeat(60)])) }, labels: { waiting: 'w'.repeat(200) } }
  const response = await fetch(`${live.url}/rooms/482113/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' }, body: JSON.stringify({ state }) })
  assert.equal(response.status, 200)
  assert.equal((await events('482113', 1))[0].data.state.activity.options.length, 20)
})

test('states from named screens are ordered by when the server heard them, not by their clocks', () => {
  let t = 1000
  const rooms = createRooms({ now: () => t })
  // The iPad's clock is a minute behind the laptop's.
  assert.equal(rooms.setState('s', { index: 1, screen: 'laptop', at: 90000 }), true)
  t += 5000
  assert.equal(rooms.setState('s', { index: 2, screen: 'ipad', at: 30000 }), true, 'a later change from a slow clock still wins')
  t += 4000
  assert.equal(rooms.setState('s', { index: 1, screen: 'laptop', at: 90000 }), false, 'the laptop repeating its older change')
  assert.equal(rooms.setState('s', { index: 0, screen: 'new-tab', at: 0 }), false, 'a screen that just opened')
  t += 1000
  assert.equal(rooms.setState('s', { index: 3, screen: 'laptop', at: 95000 }), true, 'the laptop moves on')
  assert.equal(rooms.state('s').index, 3)
})

test('a state whose screen went quiet does not keep a new screen from the phones', () => {
  let t = 1000
  const rooms = createRooms({ now: () => t })
  assert.equal(rooms.setState('s', { index: 4, screen: 'yesterday', at: 90000 }), true)
  t += 4000
  assert.equal(rooms.setState('s', { index: 0, screen: 'new-tab', at: 0 }), false, 'while the talk goes on, a screen that just opened waits')
  t += 20000
  assert.equal(rooms.setState('s', { index: 0, screen: 'presenter', at: 0 }), true, 'the talk ended: the new presenter view takes the phones')
  assert.equal(rooms.state('s').index, 0)
  t += 4000
  assert.equal(rooms.setState('s', { index: 0, screen: 'new-tab', at: 0 }), true, 'another screen that just opened ties with it')
})

test('in the stage room a presenter who stays on a slide keeps it from a window that opens later', () => {
  let t = 1000
  const rooms = createRooms({ now: () => t })
  assert.equal(rooms.setState('s.stage', { index: 4, screen: 'laptop', at: 90000 }), true)
  t += 60000
  assert.equal(rooms.setState('s.stage', { index: 0, screen: 'ipad', at: 0 }), false, 'the iPad opening on the first slide follows the laptop')
  assert.equal(rooms.state('s.stage').index, 4)
  assert.equal(rooms.setState('s.stage', { index: 5, screen: 'ipad', at: 95000 }), true, 'a change on the iPad still counts')
})

test('only the presenter relays ink; listeners get it at once and late ones get the changes', async () => {
  const relay = (messages, headers = {}) => fetch(`${live.url}/rooms/deck.stage/ink`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ messages }) })
  const op = { type: 'op', key: 'a:op', op: { type: 'add', slideId: 's', stroke: { id: 'a:1', points: [[1, 2, 0.5]] } } }
  assert.equal((await relay([op])).status, 403)
  const reply = await relay([op], { Authorization: 'Bearer secret' })
  assert.deepEqual(await reply.json(), { ok: true, listeners: 0 })
  const segment = { type: 'segment', key: 'a:2', slideId: 's', from: 0, points: [[3, 4, 0.5]] }
  const seen = await events('deck.stage', 2, () => relay([segment], { Authorization: 'Bearer secret' }))
  assert.deepEqual(seen[0].data.ink, [op], 'the snapshot has the changes, not the strokes in progress')
  assert.deepEqual(seen[1], { type: 'ink', data: { messages: [segment] } })
  assert.equal((await relay(Array.from({ length: 101 }, () => segment), { Authorization: 'Bearer secret' })).status, 400)
})

test('windows that say what they are count as connected to their session, and leave when they close', async () => {
  const open = []
  const connect = async (room, query) => { const controller = new AbortController(); open.push(controller); await fetch(`${live.url}/rooms/${room}/events?${query}`, { signal: controller.signal }) }
  const seen = await events('424242.stage', 4, async () => {
    await connect('424242.stage', 'view=presenter&device=ipad')
    await connect('424242', 'view=phone&device=phone')
    open.shift().abort()
  }, '?presence=1')
  assert.deepEqual(seen[0].data.presence, { views: [], phones: 0, followers: 0 })
  assert.deepEqual(seen.slice(1).map(event => event.data), [
    { views: [{ view: 'presenter', device: 'ipad' }], phones: 0, followers: 0 },
    { views: [{ view: 'presenter', device: 'ipad' }], phones: 1, followers: 0 },
    { views: [], phones: 1, followers: 0 },
  ])
  for (const controller of open) controller.abort()
  // Unknown views do not count, unknown devices are computers, and only asking windows hear it.
  const rooms = createRooms()
  rooms.subscribe('1.stage', () => {}, { view: 'audience', device: 'computer' })
  rooms.subscribe('2.stage', () => {}, { view: 'deck', device: 'computer' })
  assert.deepEqual(rooms.presence('1'), { views: [{ view: 'audience', device: 'computer' }], phones: 0, followers: 0 })
  // Followers (?view=follow) count as phones, and apart: they cannot answer.
  rooms.subscribe('1.stage', () => {}, { view: 'follow', device: 'computer' })
  rooms.subscribe('1', () => {}, { view: 'phone', device: 'phone' })
  assert.deepEqual(rooms.presence('1'), { views: [{ view: 'audience', device: 'computer' }], phones: 2, followers: 1 })
  // The same, asked once; closed connections leave a moment after they close.
  const ask = async () => (await fetch(`${live.url}/rooms/424242.stage/presence`)).json()
  for (let tries = 0; (await ask()).phones && tries < 50; tries++) await new Promise(done => setTimeout(done, 20))
  assert.deepEqual(await ask(), { views: [], phones: 0, followers: 0 })
  const quiet = await events('424243.stage', 1, undefined, '?view=nonsense&device=toaster')
  assert.equal(quiet[0].data.presence, undefined)
})

test('phones that joined another server count in the local stage room', () => {
  const rooms = createRooms()
  const heard = []
  rooms.subscribe('123456.stage', event => { if (event.type === 'presence') heard.push(event.presence.phones) }, { view: 'presenter', device: 'computer' })
  rooms.setAwayPhones('123456', 3)
  assert.equal(rooms.presence('123456.stage').phones, 3)
  assert.equal(rooms.presence('123456.stage').views.length, 1, 'the presenter view stays a view')
  rooms.setAwayPhones('123456', 3)
  rooms.setAwayPhones('123456', 1)
  assert.deepEqual(heard.slice(-2), [3, 1], 'told only when the number changes')
})

test('only the presenter sends a picture; phones get it by its version, and the state says which one the room holds', async () => {
  const room = '482114'
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const send = (body, type = 'image/png', headers = { Authorization: 'Bearer secret' }) => fetch(`${live.url}/rooms/${room}/image`, { method: 'POST', headers: { 'Content-Type': type, ...headers }, body })
  assert.equal((await send(png, 'image/png', {})).status, 403)
  assert.equal((await send('<svg onload="alert(1)"/>', 'image/svg+xml')).status, 415, 'never SVG')
  assert.equal((await send(Buffer.alloc(0))).status, 400)
  assert.equal((await send(Buffer.alloc(220 * 1024))).status, 413)
  assert.equal((await fetch(`${live.url}/rooms/${room}/image`)).status, 404)
  const sent = await send(png)
  assert.equal(sent.status, 200)
  const { version } = await sent.json()
  const got = await fetch(`${live.url}/rooms/${room}/image?v=${version}`)
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/png')
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), png)
  assert.equal((await fetch(`${live.url}/rooms/${room}/image?v=${version}`, { headers: { 'If-None-Match': got.headers.get('etag') } })).status, 304)
  const state = await fetch(`${live.url}/rooms/${room}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' }, body: JSON.stringify({ state: { room: 'heart', activity: { type: 'pin', image: { url: `rooms/${room}/image?v=${version}`, ratio: 0.5 } } } }) })
  assert.equal((await state.json()).image, version)
  // The next picture replaces it, and a link to the one before finds none.
  const next = await (await send(Buffer.concat([png, Buffer.from([1])]))).json()
  assert.notEqual(next.version, version)
  assert.equal((await fetch(`${live.url}/rooms/${room}/image?v=${version}`)).status, 404)
  assert.equal((await fetch(`${live.url}/rooms/${room}/image?v=${next.version}`)).status, 200)
  // A slide without a <pinpoint> lets the picture go.
  const away = await fetch(`${live.url}/rooms/${room}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' }, body: JSON.stringify({ state: { room: 'votes', activity: { type: 'poll' } } }) })
  assert.equal((await away.json()).image, undefined)
  assert.equal((await fetch(`${live.url}/rooms/${room}/image?v=${next.version}`)).status, 404)
})
