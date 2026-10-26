import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket, { WebSocketServer } from 'ws'
import { startLiveServer } from '../src/live/server.js'
import { startTunnel, shareable, newTunnelId, loopbackUrl } from '../src/build/tunnelClient.js'
import { isAllowedRequest } from '../src/build/editorPlugin.js'

const KEY = 'room-server-key'
const base = id => `/t/${id}/`
const rules = id => ({ base: base(id), resources: new Set(['main.jsx', '@vite/client', '@id/__x00__virtual:slides', 'node_modules/.vite/deps/preact.js', '@fs/opt/mdeck/src/runtime/deck-stage.js', '@fs/home/me/talk/img/photo.png', 'img/photo.png', '@fs/home/me/.mdeck/extensions/themes/fhnw/styles.css'].map(path => base(id) + path)) })

test('the session\'s rooms are shareable, with the picture of a pinpoint', () => {
  const id = newTunnelId()
  const ok = (path, method = 'GET') => shareable(`${base(id)}__mdeck/live/rooms/${path}`, method, { ...rules(id), session: '123456' })
  assert.ok(ok('123456.p1/events'))
  assert.ok(ok('123456.p1/state', 'POST'))
  assert.ok(ok('123456.p1/image', 'POST'))
  assert.ok(ok('123456.p1/image'))
  assert.ok(!ok('123456.p1/image', 'DELETE'))
  assert.ok(!ok('654321.p1/image', 'POST'))
})

test('only what the presenter and audience pages need is shareable', () => {
  const id = newTunnelId()
  const ok = (path, method = 'GET') => shareable(path, method, rules(id))
  const at = path => `${base(id)}${path}`
  // the pages and what they load
  assert.ok(ok(base(id)))
  assert.ok(ok(at('main.jsx')))
  assert.ok(ok(at('@vite/client')))
  assert.ok(ok(at('@id/__x00__virtual:slides')))
  assert.ok(ok(at('node_modules/.vite/deps/preact.js')))
  assert.ok(ok(at('@fs/opt/mdeck/src/runtime/deck-stage.js')))
  assert.ok(ok(at('@fs/home/me/talk/img/photo.png')))
  assert.ok(ok(at('img/photo.png')))
  assert.ok(ok(at('@fs/home/me/.mdeck/extensions/themes/fhnw/styles.css')), 'a theme installed in a dot directory')
  assert.ok(ok(at('__mdeck/ink')))
  assert.ok(ok(at('__mdeck/ink/ops'), 'POST'))
  assert.ok(ok(at('__mdeck/pair/claim'), 'POST'))
  assert.ok(ok(at('__mdeck/pair/status')))
  // the launch page, the editor, the deck's own files and everything else
  assert.ok(!ok(at('home.html')))
  assert.ok(!ok(at('editor.html')))
  assert.ok(!ok(at('design.html')))
  assert.ok(!ok(at('__mdeck/home/info')))
  assert.ok(!ok(at('__mdeck/home/action'), 'POST'))
  assert.ok(!ok(at('__mdeck/deck')))
  assert.ok(!ok(at('__mdeck/source'), 'POST'))
  assert.ok(!ok(at('slides.md')))
  assert.ok(!ok(at('slides.drawings.json')))
  assert.ok(!ok(at('.env')))
  assert.ok(!ok(at('notes/.git/config')))
  assert.ok(!ok(at('@fs/home/me/.mdeck/extensions/themes/fhnw/manifest.json')))
  assert.ok(!ok(at('@fs/home/me/.mdeck/extensions/themes/fhnw/print.css')), 'only approved files')
  assert.ok(!ok(at('@fs/etc/passwd')))
  assert.ok(!ok(at('@fs/home/me/talk/secret.txt')))
  assert.ok(!ok(at('@fs/home/me/talk-other/x.js')))
  assert.ok(!ok(at('../x.js')))
  assert.ok(!ok(at('a/%2e%2e/home.html')))
  assert.ok(!ok(at('main.jsx'), 'DELETE'))
  assert.ok(!ok(at('__mdeck/ink'), 'POST'))
  assert.ok(!ok('/home.html'))
  assert.ok(!ok('/t/other/main.jsx'))
})

test('a request that came through the tunnel is never taken for this computer', () => {
  assert.equal(isAllowedRequest({ headers: { host: 'localhost:5173' } }), true)
  assert.equal(isAllowedRequest({ headers: { host: 'localhost:5173', 'x-mdeck-tunnel': '1' } }), false)
  assert.equal(isAllowedRequest({ headers: { host: 'localhost:5173' }, socket: { remoteAddress: '192.168.1.50' } }), false, 'a remote peer cannot spoof the loopback Host header')
  assert.equal(isAllowedRequest({ headers: { host: 'localhost:5173' }, socket: { remoteAddress: '::ffff:127.0.0.1' } }), true)
})

// A server, a fake dev server and the tunnel between them.
async function setup(t, { base: pathBase, key = KEY, tokens = [], pingMs } = {}) {
  const live = await startLiveServer({ port: 0, key })
  const id = newTunnelId()
  const seen = []
  const local = http.createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() })
      if (request.url.endsWith('/big.png')) { response.writeHead(200, { 'Content-Type': 'image/png' }); return response.end(Buffer.alloc(900 * 1024, 7)) }
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Length': '13', 'X-Local': 'yes' })
      response.end('export {}; //')
    })
  })
  const sockets = new WebSocketServer({ server: local, handleProtocols: protocols => [...protocols][0] })
  sockets.on('connection', (ws, request) => { seen.push({ ws: request.url, headers: request.headers }); ws.on('message', (data, bin) => ws.send(data, { binary: bin })) })
  await new Promise(done => local.listen(0, '127.0.0.1', done))
  const target = `http://127.0.0.1:${local.address().port}${base(id)}`
  const states = []
  const tunnel = startTunnel({ server: live.url, key, id, target, base: pathBase ?? base(id), resources: new Set(['main.jsx', 'big.png'].map(path => base(id) + path)), session: () => '123456', tokens: () => tokens, onState: (state, reason) => states.push([state, reason]), pingMs })
  t.after(async () => { tunnel.stop(); sockets.close(); local.closeAllConnections(); local.close(); await live.close() })
  const upTo = async () => { for (let i = 0; i < 100 && !states.some(([state]) => state === 'up' || state === 'refused'); i++) await delay(20) }
  await upTo()
  return { live, id, seen, tunnel, states, url: `${live.url}${base(id)}`, upTo }
}

test('a browser reaches the computer through the server', async t => {
  const { url, seen, id } = await setup(t)
  const response = await fetch(`${url}main.jsx?import`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'export {}; //')
  assert.equal(response.headers.get('x-local'), 'yes')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer', 'the secret address does not leak through Referer')
  const got = seen.at(-1)
  assert.equal(got.url, `${base(id)}main.jsx?import`, 'the address is passed on unchanged')
  assert.equal(got.headers['x-mdeck-tunnel'], '1', 'the dev server can tell it came through the tunnel')
  assert.match(got.headers.host, /^127\.0\.0\.1:\d+$/)
  assert.equal(got.headers.cookie, undefined)
})

test('a large answer arrives whole', async t => {
  const { url } = await setup(t)
  const body = Buffer.from(await (await fetch(`${url}big.png`)).arrayBuffer())
  assert.equal(body.length, 900 * 1024)
  assert.ok(body.every(byte => byte === 7))
})

test('a request body is passed on', async t => {
  const { url, seen } = await setup(t)
  const response = await fetch(`${url}__mdeck/ink/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' }, body: JSON.stringify({ ops: [1, 2] }) })
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(seen.at(-1).body), { ops: [1, 2] })
  assert.equal(seen.at(-1).headers.authorization, 'Bearer abc')
})

test('addresses that are not shared never reach the computer', async t => {
  const { url, seen } = await setup(t)
  const before = seen.length
  for (const path of ['home.html', '__mdeck/home/info', '__mdeck/deck', 'slides.md', '.env', 'private.toml', 'private.js?raw', 'confidential.pdf', '@id/__x00__private', 'main.jsx?raw']) {
    const response = await fetch(`${url}${path}`)
    assert.equal(response.status, 403, path)
  }
  assert.equal(seen.length, before)
})

test('an unknown or stopped tunnel answers 404', async t => {
  const { live, url, tunnel } = await setup(t)
  assert.equal((await fetch(`${live.url}/t/${newTunnelId()}/main.jsx`)).status, 404)
  tunnel.stop()
  for (let i = 0; i < 100 && (await fetch(`${url}main.jsx`)).status !== 404; i++) await delay(20)
  assert.equal((await fetch(`${url}main.jsx`)).status, 404)
})

test('the server refuses a wrong key', async t => {
  const live = await startLiveServer({ port: 0, key: KEY })
  t.after(() => live.close())
  const states = []
  const tunnel = startTunnel({ server: live.url, key: 'wrong', id: newTunnelId(), target: 'http://127.0.0.1:1/', base: '/t/x/', onState: (state, reason) => states.push([state, reason]) })
  t.after(() => tunnel.stop())
  for (let i = 0; i < 100 && !states.some(([state]) => state === 'refused'); i++) await delay(20)
  assert.deepEqual(states.at(-1), ['refused', 'The server did not accept the key'])
})

test('a server that answers 502, as a web server does while it restarts, is tried again', async t => {
  let attempts = 0
  const proxy = http.createServer((_request, response) => { response.writeHead(502); response.end() })
  proxy.on('upgrade', (_request, socket) => { attempts++; socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n') })
  await new Promise(done => proxy.listen(0, '127.0.0.1', done))
  t.after(() => { proxy.closeAllConnections(); proxy.close() })
  const states = []
  const tunnel = startTunnel({ server: `http://127.0.0.1:${proxy.address().port}`, key: KEY, id: newTunnelId(), target: 'http://127.0.0.1:1/', base: '/t/x/', onState: (state, reason) => states.push([state, reason]) })
  t.after(() => tunnel.stop())
  for (let i = 0; i < 150 && attempts < 2; i++) await delay(20)
  assert.ok(attempts >= 2, 'tried again')
  assert.ok(states.some(([state]) => state === 'down'))
  assert.ok(!states.some(([state]) => state === 'refused'))
})

test('the tunnel pings the server and stays up while it answers', async t => {
  const { tunnel, states } = await setup(t, { pingMs: 30 })
  await delay(150)
  assert.equal(tunnel.state(), 'up')
  assert.equal(states.filter(([state]) => state === 'up').length, 1, 'never dropped')
})

test('a bad status or header from the computer gets a 502, and the server stays up', async t => {
  const live = await startLiveServer({ port: 0, key: KEY })
  t.after(() => live.close())
  const id = newTunnelId()
  // A laptop of our own, answering by hand.
  const laptop = new WebSocket(`${live.url.replace('http', 'ws')}/tunnel/${id}`, { headers: { Authorization: `Bearer ${KEY}` } })
  await new Promise((done, fail) => { laptop.once('open', done); laptop.once('error', fail) })
  t.after(() => laptop.terminate())
  const answers = [
    { status: 'nope', headers: { 'x-ok': 'yes' } },
    { status: 200, headers: { 'x-bad': 'a\r\nb' } },
    { status: 200, headers: { 'bad name': 'x' } },
    { status: 200, headers: 'nonsense' },
  ]
  laptop.on('message', raw => {
    const message = JSON.parse(raw.toString())
    if (message.t !== 'req') return
    const answer = answers.shift()
    laptop.send(JSON.stringify({ t: 'head', id: message.id, ...answer }))
    laptop.send(JSON.stringify({ t: 'data', id: message.id, b: Buffer.from('hi').toString('base64') }))
    laptop.send(JSON.stringify({ t: 'end', id: message.id }))
  })
  assert.equal((await fetch(`${live.url}/t/${id}/a`)).status, 502, 'a status that is not one')
  assert.equal((await fetch(`${live.url}/t/${id}/b`)).status, 502, 'a header value with a line break')
  assert.equal((await fetch(`${live.url}/t/${id}/c`)).status, 502, 'a header name that is not one')
  const last = await fetch(`${live.url}/t/${id}/d`)
  assert.equal(last.status, 200, 'headers that are not an object are left out')
  assert.equal(await last.text(), 'hi')
})

test('without a key the server offers no tunnels', async t => {
  const live = await startLiveServer({ port: 0 })
  t.after(() => live.close())
  assert.equal((await fetch(`${live.url}/t/${newTunnelId()}/`)).status, 404)
  const states = []
  const tunnel = startTunnel({ server: live.url, key: 'anything', id: newTunnelId(), target: 'http://127.0.0.1:1/', base: '/t/x/', onState: (state, reason) => states.push([state, reason]) })
  t.after(() => tunnel.stop())
  for (let i = 0; i < 100 && !states.some(([state]) => state === 'refused'); i++) await delay(20)
  assert.equal(states.at(-1)[0], 'refused')
})

test('a paired device may steer rooms while its tunnel is open, and no longer after', async t => {
  const device = 'device-token-0123456789abcdef'
  const { live, tunnel } = await setup(t, { tokens: [device] })
  const canReset = async token => (await (await fetch(`${live.url}/info`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).json()).canReset
  for (let i = 0; i < 100 && !(await canReset(device)); i++) await delay(20)
  assert.equal(await canReset(device), true)
  assert.equal(await canReset('someone-else-0123456789abcdef'), false)
  assert.equal(await canReset(KEY), true)
  const room = await fetch(`${live.url}/rooms/123456.abc/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${device}` }, body: JSON.stringify({ state: { at: 1, screen: 'ipad' } }) })
  assert.equal(room.status, 200)
  const other = await fetch(`${live.url}/rooms/654321.abc/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${device}` }, body: JSON.stringify({ state: {} }) })
  assert.equal(other.status, 403, 'a device cannot control another session')
  tunnel.stop()
  for (let i = 0; i < 100 && await canReset(device); i++) await delay(20)
  assert.equal(await canReset(device), false)
})

test('the reload channel of the dev server is passed through, and only that', async t => {
  const { live, id, seen } = await setup(t)
  const url = `${live.url.replace('http', 'ws')}${base(id)}`
  const socket = new WebSocket(url, 'vite-hmr')
  const got = new Promise(done => socket.once('message', data => done(data.toString())))
  await new Promise((done, fail) => { socket.once('open', done); socket.once('error', fail) })
  assert.equal(socket.protocol, 'vite-hmr')
  socket.send('{"type":"ping"}')
  assert.equal(await got, '{"type":"ping"}')
  assert.equal(seen.find(item => item.ws).headers['x-mdeck-tunnel'], '1')
  socket.close()

  const other = new WebSocket(`${url}__mdeck/live`, 'vite-hmr')
  const closed = new Promise(done => { other.once('close', code => done(code)); other.once('error', () => {}) })
  other.once('open', () => other.send('x'))
  assert.notEqual(await closed, 1000)
})

test('the relay reaches the dev server on the loopback address it listens on', () => {
  assert.equal(loopbackUrl('http://localhost:5173/t/abc/', { address: '127.0.0.1', family: 'IPv4', port: 5173 }), 'http://127.0.0.1:5173/t/abc/')
  assert.equal(loopbackUrl('http://localhost:5173/t/abc/', { address: '::1', family: 'IPv6', port: 5173 }), 'http://[::1]:5173/t/abc/')
  assert.equal(loopbackUrl('http://localhost:5173/', { address: '::', family: 'IPv6', port: 5173 }), 'http://localhost:5173/', 'listening on every address: localhost works')
  assert.equal(loopbackUrl('http://localhost:5173/', null), 'http://localhost:5173/')
})
