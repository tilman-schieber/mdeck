// The computer's end of `mdeck run --server` (the server's end is
// src/live/tunnel.js). It keeps one outbound WebSocket to the server and
// answers what comes down it from the local dev server, so an iPad can reach
// the slides through the server without any open port here.
//
// This is the trust boundary. Requests that arrive through the tunnel look,
// to the dev server, like requests from this computer, so two things stand
// between them and the launch page, the editor and the files around the deck:
// only addresses the presenter and audience pages need are forwarded
// (`shareable`), and every forwarded request carries a mark that makes
// `isAllowedRequest` refuse it, so it must show a paired device's token.
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import { TUNNEL_MARK } from './editorPlugin.js'

/** A name for the tunnel nobody can guess: it is the secret part of the address. */
export const newTunnelId = () => randomBytes(18).toString('base64url')

/**
 * The dev server's address with the loopback address it listens on, when it
 * listens on one: `localhost` may resolve to the other (IPv4 or IPv6).
 */
export function loopbackUrl(url, bound) {
  const address = typeof bound === 'object' ? bound?.address : null
  if (!address || !(address === '::1' || /^127\./.test(address))) return url
  const local = new URL(url)
  local.hostname = address.includes(':') ? `[${address}]` : address
  return local.href
}

const READ = new Set(['GET', 'HEAD'])
const CHUNK = 256 * 1024

/**
 * Whether an address may be served through the tunnel. `base` is the dev
 * server's base path (/t/<id>/); `resources` lists exact approved module
 * and asset URLs, including semantic queries such as ?raw.
 */
export function resourceKey(address) {
  const url = new URL(address, 'http://localhost')
  for (const name of ['t', 'v', 'import']) url.searchParams.delete(name)
  url.searchParams.sort()
  return decodeURIComponent(url.pathname) + url.search
}

export function shareable(address, method, { base, resources = new Set(), session = null }) {
  let url
  try { url = new URL(address, 'http://localhost') } catch { return false }
  const pathname = url.pathname
  if (!pathname.startsWith(base)) return false
  let rest
  try { rest = decodeURIComponent(pathname.slice(base.length)) } catch { return false }
  const parts = rest.split('/')
  if (rest.includes('\0') || rest.includes('\\') || parts.includes('..')) return false
  if (rest === '' || rest === 'index.html') return READ.has(method)
  if (parts.some(part => part.startsWith('.') && part !== '.vite')) return false
  if (rest === '__mdeck/ink') return method === 'GET'
  if (rest === '__mdeck/ink/ops' || rest === '__mdeck/pair/claim') return method === 'POST'
  if (rest === '__mdeck/live/info' || rest === '__mdeck/position') return READ.has(method)
  const room = rest.match(/^__mdeck\/live\/rooms\/([^/]+)(\/events|\/state|\/reset|\/ink)?$/)
  if (room && session && (room[1] === session || room[1].startsWith(`${session}.`))) return room[2] === '/events' ? method === 'GET' : method === 'POST'
  if (rest.startsWith('__mdeck/')) return false
  if (!READ.has(method)) return false
  try { return resources.has(resourceKey(url.href)) } catch { return false }
}

/**
 * Opens the tunnel and keeps it open, reconnecting after a drop. `server` is
 * the server's address, `target` the dev server's (a URL), `tokens` the
 * paired devices' tokens (sent to the server so they may steer rooms).
 * Returns { url, state(), push(), stop() }; `onState` hears 'connecting',
 * 'up', 'down' and 'refused' with a reason.
 */
export function startTunnel({ server, key, id, target, base, resources = new Set(), allow = (path, method) => shareable(path, method, { base, resources, session: session() }), session = () => null, tokens = () => [], onState = () => {}, log = () => {} }) {
  const root = server.replace(/\/+$/, '')
  const socketUrl = new URL(`${root}/tunnel/${id}`)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const local = new URL(target)
  let socket = null, state = 'connecting', stopped = false, delay = 1000, timer = null
  const requests = new Map(), peers = new Map()

  const set = (next, reason) => { state = next; onState(next, reason) }
  const send = message => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)) }
  const push = () => send({ t: 'tokens', tokens: tokens(), session: session() })
  const refuse = (id, status, message) => send({ t: 'err', id, status, message })

  function pace(res) {
    if (!socket || socket.bufferedAmount < 8 * 1024 * 1024) return
    res.pause()
    const poll = setInterval(() => { if (!socket || socket.bufferedAmount < 1024 * 1024) { clearInterval(poll); res.resume() } }, 20)
  }

  async function onRequest({ id, method, path, headers = {}, body }) {
    let url
    try { url = new URL(path, 'http://localhost') } catch { return refuse(id, 400, 'Bad address') }
    if (typeof method !== 'string' || !await allow(url.pathname + url.search, method)) {
      log(`not shared: ${method} ${url.pathname}`)
      return refuse(id, 403, 'This address is not shared')
    }
    const outgoing = { ...headers, host: local.host, [TUNNEL_MARK]: '1' }
    const request = http.request({ hostname: local.hostname.replace(/^\[|\]$/g, ''), port: local.port, method, path: url.pathname + url.search, headers: outgoing }, res => {
      send({ t: 'head', id, status: res.statusCode, headers: res.headers })
      res.on('data', chunk => {
        for (let at = 0; at < chunk.length; at += CHUNK) send({ t: 'data', id, b: chunk.subarray(at, at + CHUNK).toString('base64') })
        pace(res)
      })
      res.on('end', () => { requests.delete(id); send({ t: 'end', id }) })
      res.on('error', () => { requests.delete(id); refuse(id, 502, 'The local server stopped answering') })
    })
    requests.set(id, request)
    request.on('error', error => { requests.delete(id); refuse(id, 502, `The local server did not answer: ${error.message}`) })
    request.end(body ? Buffer.from(body, 'base64') : undefined)
  }

  function onSocketOpen({ id, path, protocols = [] }) {
    let url
    try { url = new URL(path, 'http://localhost') } catch { return send({ t: 'wsclose', id, code: 1008 }) }
    // Only the dev server's reload channel, at its base address.
    if (url.pathname !== base || !protocols.every(item => /^vite-/.test(item))) { log(`not shared: WebSocket ${url.pathname}`); return send({ t: 'wsclose', id, code: 1008 }) }
    const queue = []
    const peer = new WebSocket(`ws://${local.host}${url.pathname}${url.search}`, protocols, { headers: { origin: local.origin, [TUNNEL_MARK]: '1' } })
    peers.set(id, { peer, queue })
    peer.on('open', () => { for (const [data, bin] of queue.splice(0)) peer.send(data, { binary: bin }) })
    peer.on('message', (data, bin) => send({ t: 'wsmsg', id, b: Buffer.from(data).toString('base64'), bin }))
    peer.on('close', code => { if (peers.delete(id)) send({ t: 'wsclose', id, code }) })
    peer.on('error', () => {})
  }

  function onMessage(raw) {
    let message
    try { message = JSON.parse(raw.toString()) } catch { return }
    switch (message?.t) {
      case 'req': return onRequest(message).catch(() => refuse(message.id, 502, 'Could not check the shared resource'))
      case 'abort': requests.get(message.id)?.destroy(); requests.delete(message.id); return
      case 'wsopen': return onSocketOpen(message)
      case 'wsmsg': {
        const entry = peers.get(message.id)
        if (!entry || typeof message.b !== 'string') return
        const data = Buffer.from(message.b, 'base64')
        const payload = message.bin ? data : data.toString('utf8')
        if (entry.peer.readyState === WebSocket.OPEN) entry.peer.send(payload, { binary: !!message.bin })
        else entry.queue.push([payload, !!message.bin])
        return
      }
      case 'wsclose': { const entry = peers.get(message.id); if (entry) { peers.delete(message.id); entry.peer.close() } }
    }
  }

  function connect() {
    if (stopped) return
    set('connecting')
    socket = new WebSocket(socketUrl, { headers: { Authorization: `Bearer ${key}` } })
    let refused = false
    socket.on('open', () => { delay = 1000; set('up'); push() })
    socket.on('message', onMessage)
    socket.on('unexpected-response', (_request, response) => {
      refused = true
      response.resume()
      const status = response.statusCode
      set('refused', status === 401 ? 'The server did not accept the key' : status === 404 ? 'The server does not offer sharing: update mdeck there and start it with MDECK_SERVER_KEY' : status === 503 ? 'The server has too many shared presentations' : `The server answered ${status}`)
    })
    socket.on('error', error => { if (!refused) log(`tunnel: ${error.message}`) })
    socket.on('close', () => {
      for (const request of requests.values()) request.destroy()
      requests.clear()
      for (const { peer } of peers.values()) peer.terminate()
      peers.clear()
      socket = null
      if (stopped || refused) return
      set('down')
      timer = setTimeout(connect, delay)
      delay = Math.min(delay * 2, 15000)
    })
  }

  connect()
  return {
    url: `${root}/t/${id}/`,
    state: () => state,
    push,
    stop() { stopped = true; clearTimeout(timer); socket?.close(1000); socket?.terminate() },
  }
}
