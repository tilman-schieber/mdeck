import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createPairing, pairingMiddleware, pairingStoreFor } from '../src/build/pairing.js'
import { homeMiddleware } from '../src/build/homePlugin.js'
import { createInkFile, inkMiddleware } from '../src/build/inkPlugin.js'
import { isAllowedRequest } from '../src/build/editorPlugin.js'
import { createServer } from 'node:http'
import { startLiveServer, controlProxy } from '../src/live/server.js'

const bearer = token => ({ headers: { host: '192.168.1.20:5173', authorization: `Bearer ${token}` } })

test('a pairing code works once, for ten minutes, and unpairing ends every pairing', () => {
  let t = 0
  const pairing = createPairing({ now: () => t })
  const offer = pairing.offer()
  const device = pairing.claim(offer)
  assert.ok(device && device !== offer)
  assert.equal(pairing.claim(offer), null, 'used once')
  assert.equal(pairing.allows(bearer(device)), true)
  assert.equal(pairing.allows(bearer(offer)), false, 'the code in the QR is not a device token')
  assert.equal(pairing.allows(bearer('')), false)
  const late = pairing.offer()
  t += 11 * 60 * 1000
  assert.equal(pairing.claim(late), null, 'too old')
  assert.equal(pairing.devices, 1)
  pairing.revoke()
  assert.equal(pairing.allows(bearer(device)), false)
})

test('with a store, a pairing outlasts a restart of mdeck run until unpaired or unused for 30 days', () => {
  let t = 0
  const store = resolve(mkdtempSync(resolve(tmpdir(), 'mdeck-paired-')), 'mdeck', 'paired', 'deck.json')
  const first = createPairing({ now: () => t, store })
  const device = first.claim(first.offer())
  if (process.platform !== 'win32') assert.equal(statSync(store).mode & 0o777, 0o600, 'only this user may read the tokens')
  assert.equal(readFileSync(store, 'utf8').includes(first.offer()), false, 'codes not yet used are not kept')
  t += 5 * 24 * 60 * 60 * 1000
  const again = createPairing({ now: () => t, store })
  assert.equal(again.allows(bearer(device)), true, 'the iPad stays paired after a restart')
  assert.equal(again.devices, 1)
  t += 29 * 24 * 60 * 60 * 1000
  assert.equal(createPairing({ now: () => t, store }).allows(bearer(device)), true, 'its use counted')
  t += 31 * 24 * 60 * 60 * 1000
  assert.equal(createPairing({ now: () => t, store }).allows(bearer(device)), false, 'unused for 30 days: forgotten')
  const later = createPairing({ now: () => t, store })
  later.claim(later.offer())
  later.revoke()
  assert.equal(existsSync(store), false, 'unpairing removes the file')
  assert.equal(createPairing({ now: () => t, store }).devices, 0)
})

test('each deck keeps its paired devices in mdeck\'s own folder', () => {
  const a = pairingStoreFor('/talks/a.md', { home: '/home/me/.mdeck' }), b = pairingStoreFor('/talks/b.md', { home: '/home/me/.mdeck' })
  assert.ok(a.startsWith(resolve('/home/me/.mdeck/paired')) && a.endsWith('.json'))
  assert.notEqual(a, b)
  assert.ok(pairingStoreFor('/talks/a.md').startsWith(resolve(process.env.MDECK_HOME, 'paired')))
})

const call = (handler, request) => new Promise(done => {
  const response = { status: 200, setHeader() {}, writeHead(status) { this.status = status }, end(body) { done({ status: this.status, body: body ? JSON.parse(body) : null }) } }
  const body = request.body == null ? null : JSON.stringify(request.body)
  const stream = { ...request, headers: { 'content-type': 'application/json', ...request.headers }, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body) }, on(event, fn) { if (event === 'data' && body) fn(Buffer.from(body)); if (event === 'end') fn(); return this } }
  handler(stream, response, () => done({ status: 'next' }))
})

test('an iPad trades the code for its own token and may then save ink', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mdeck-pairing-'))
  const deck = resolve(dir, 'talk.md')
  writeFileSync(deck, '---\ntheme: neue\nserver: https://rooms.example\n---\n\n---\nid: s\n---\n# S\n')
  const pairing = createPairing()
  const home = homeMiddleware(deck, { pairing, serverKey: 'room-key', urls: () => ({ local: ['http://localhost:5173/'], network: ['http://192.168.1.20:5173/'] }), fetch: async () => ({ ok: false, status: 500 }) })
  const offered = await call(home, { url: '/action', method: 'POST', headers: { host: 'localhost:5173' }, body: { action: 'pair' } })
  const url = new URL(offered.body.url)
  assert.equal(url.origin, 'http://192.168.1.20:5173')
  assert.equal(url.searchParams.get('view'), 'presenter')
  assert.equal(url.searchParams.get('serverkey'), null, 'the master key never enters the pairing address')
  assert.equal((await call(home, { url: '/action', method: 'POST', headers: { host: '192.168.1.20:5173' }, body: { action: 'pair' } })).status, 403, 'only this computer offers codes')

  const claim = pairingMiddleware(pairing)
  const claimed = await call(claim, { url: '/claim', method: 'POST', headers: { host: '192.168.1.20:5173' }, body: { token: url.searchParams.get('pair') } })
  assert.equal(claimed.status, 200)
  assert.equal((await call(claim, { url: '/claim', method: 'POST', headers: { host: '192.168.1.20:5173' }, body: { token: url.searchParams.get('pair') } })).status, 403)
  const status = token => call(claim, { url: '/status', method: 'GET', headers: { host: '192.168.1.20:5173', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
  assert.deepEqual((await status(claimed.body.token)).body, { paired: true })
  assert.deepEqual((await status(null)).body, { paired: false })

  const ink = inkMiddleware(createInkFile(deck), { authorize: request => isAllowedRequest(request) || pairing.allows(request) })
  assert.equal((await call(ink, { url: '/', method: 'GET', headers: { host: '192.168.1.20:5173' } })).status, 403)
  assert.equal((await call(ink, { url: '/', method: 'GET', headers: { host: '192.168.1.20:5173', authorization: `Bearer ${claimed.body.token}` } })).status, 200)
  const info = await call(home, { url: '/info', method: 'GET', headers: { host: 'localhost:5173' } })
  assert.deepEqual(info.body.pairing, { available: true, offline: false, devices: 1 })
  // After "Unpair" (or a restart of mdeck run) the iPad hears it is no longer paired.
  pairing.revoke()
  assert.deepEqual((await status(claimed.body.token)).body, { paired: false })
})


test('pairing storage is scoped to each tunnel', async () => {
  const { pairStorageKey } = await import('../src/live/pairing.js')
  assert.notEqual(pairStorageKey('https://relay.example', '/t/first/'), pairStorageKey('https://relay.example', '/t/second/'))
  assert.equal(pairStorageKey('https://relay.example', '/t/first/'), 'mdeck-pair:https://relay.example/t/first/')
})

test('network pairing proxies only this session and revokes control without disclosing the master key', async t => {
  const live = await startLiveServer({ port: 0, key: 'private-master-key' })
  const pairing = createPairing(), token = pairing.claim(pairing.offer())
  const proxy = createServer(controlProxy({ upstream: live.url, key: 'private-master-key', session: () => '123456', authorize: request => pairing.allows(request) }))
  await new Promise(done => proxy.listen(0, '127.0.0.1', done))
  t.after(async () => { proxy.closeAllConnections(); await new Promise(done => proxy.close(done)); await live.close() })
  const base = `http://127.0.0.1:${proxy.address().port}`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const info = async () => (await (await fetch(`${base}/info`, { headers })).json())
  assert.equal((await info()).canReset, true)
  assert.equal(JSON.stringify(await info()).includes('private-master-key'), false)
  const state = room => fetch(`${base}/rooms/${room}/state`, { method: 'POST', headers, body: JSON.stringify({ state: { screen: 'ipad', at: 1 } }) })
  assert.equal((await state('123456.stage')).status, 200)
  assert.equal((await state('654321.stage')).status, 403)
  assert.equal((await fetch(`${live.url}/rooms/123456.stage/state`, { method: 'POST', headers, body: '{}' })).status, 403, 'token alone cannot unlock another server')
  // A <pinpoint> picture goes through as it is, with the master key added.
  const picture = await fetch(`${base}/rooms/123456/image`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` }, body: Buffer.from('png') })
  assert.equal(picture.status, 200)
  assert.equal((await fetch(`${base}/rooms/123456/image?v=${(await picture.json()).version}`)).headers.get('content-type'), 'image/png')
  pairing.revoke()
  assert.equal((await info()).canReset, false)
  assert.equal((await state('123456.stage')).status, 403)
})
