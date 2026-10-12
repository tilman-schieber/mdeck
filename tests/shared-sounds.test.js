import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { sharedSounds, soundList, soundsMiddleware } from '../src/build/sharedSounds.js'

function folders() {
  const root = mkdtempSync(resolve(tmpdir(), 'mdeck-sounds-'))
  const home = resolve(root, 'home'), own = resolve(root, 'own')
  mkdirSync(home); mkdirSync(own); mkdirSync(resolve(home, 'nested.mp3'))
  writeFileSync(resolve(home, 'Gong.mp3'), Buffer.from('0123456789'))
  writeFileSync(resolve(home, 'notes.txt'), 'not a sound')
  writeFileSync(resolve(home, '.hidden.wav'), 'x')
  writeFileSync(resolve(own, 'Gong.mp3'), 'the second one')
  writeFileSync(resolve(own, 'Dick und Doof.m4a'), 'music')
  return { root, list: [home, own] }
}

test('the audio files of the shared folders, named after themselves, the first folder winning', () => {
  const { root, list } = folders()
  try {
    assert.deepEqual(sharedSounds(list).map(({ name, fileName }) => [name, fileName]), [['Gong', 'Gong.mp3'], ['Dick und Doof', 'Dick und Doof.m4a']])
    assert.deepEqual(soundList(sharedSounds(list)).map(sound => sound.src), ['./__mdeck/sounds/Gong.mp3', './__mdeck/sounds/Dick%20und%20Doof.m4a'])
    assert.deepEqual(sharedSounds([resolve(root, 'missing')]), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('mdeck run serves only those files, with byte ranges', async () => {
  const { root, list } = folders()
  const middleware = soundsMiddleware(list)
  const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404); response.end() }))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const whole = await fetch(`${base}/Gong.mp3`)
    assert.equal(whole.status, 200)
    assert.equal(whole.headers.get('content-type'), 'audio/mpeg')
    assert.equal(await whole.text(), '0123456789')
    const part = await fetch(`${base}/Gong.mp3`, { headers: { Range: 'bytes=2-4' } })
    assert.equal(part.status, 206)
    assert.equal(part.headers.get('content-range'), 'bytes 2-4/10')
    assert.equal(await part.text(), '234')
    assert.equal(await (await fetch(`${base}/Gong.mp3`, { headers: { Range: 'bytes=-3' } })).text(), '789')
    assert.equal((await fetch(`${base}/Gong.mp3`, { headers: { Range: 'bytes=20-' } })).status, 416)
    assert.equal(await (await fetch(`${base}/Dick%20und%20Doof.m4a`)).text(), 'music')
    for (const path of ['/notes.txt', '/..%2Fown%2FGong.mp3', '/.hidden.wav', '/nested.mp3']) assert.equal((await fetch(base + path)).status, 404, path)
  } finally { server.close(); rmSync(root, { recursive: true, force: true }) }
})
