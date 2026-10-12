// Sounds every deck's countdown offers (src/runtime/timer.js), besides those
// a deck lists in `timer.sounds`: the audio files in ~/.mdeck/sounds (or
// $MDECK_HOME/sounds) and in mdeck's own sounds/ folder, each named after its
// file. `mdeck run` serves them at __mdeck/sounds/<file>; builds carry none.
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { mdeckHome } from '../extensions/discover.js'
import { frameworkRoot } from '../paths.js'

export const SOUND_TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac' }
export const SOUND_ROUTE = '/__mdeck/sounds'

export const soundFolders = () => [resolve(mdeckHome(), 'sounds'), resolve(frameworkRoot, 'sounds')]

/** The shared sounds, [{ name, fileName, file }]; a file name found twice counts once, the first folder winning. */
export function sharedSounds(folders = soundFolders()) {
  const sounds = [], seen = new Set()
  for (const dir of folders) {
    let names = []
    try { names = readdirSync(dir).sort((a, b) => a.localeCompare(b)) } catch { continue }
    for (const fileName of names) {
      if (fileName.startsWith('.') || !SOUND_TYPES[extname(fileName).toLowerCase()] || seen.has(fileName)) continue
      const file = resolve(dir, fileName)
      try { if (!statSync(file).isFile()) continue } catch { continue }
      seen.add(fileName)
      sounds.push({ name: basename(fileName, extname(fileName)), fileName, file })
    }
  }
  return sounds
}

/** What the browser gets: [{ name, src }], src relative to the deck's page. */
export const soundList = sounds => sounds.map(({ name, fileName }) => ({ name, src: `.${SOUND_ROUTE}/${encodeURIComponent(fileName)}` }))

/**
 * Serves the shared sounds under SOUND_ROUTE (mounted there, so the path is
 * the file name), with byte ranges, which Safari needs to play audio. Only
 * files of the list are served; nothing else in those folders is reachable.
 */
export function soundsMiddleware(folders = soundFolders()) {
  return (request, response, next) => {
    let fileName
    try { fileName = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1)) } catch { return next() }
    const sound = sharedSounds(folders).find(entry => entry.fileName === fileName)
    if (!sound || !['GET', 'HEAD'].includes(request.method)) return next()
    const size = statSync(sound.file).size
    const type = SOUND_TYPES[extname(fileName).toLowerCase()]
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')
    let start = 0, end = size - 1
    if (range) {
      if (range[1] === '' && range[2] !== '') start = Math.max(0, size - Number(range[2]))
      else { start = Number(range[1] || 0); if (range[2] !== '') end = Math.min(size - 1, Number(range[2])) }
      if (start > end || start >= size) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); return response.end() }
    }
    response.writeHead(range ? 206 : 200, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) })
    if (request.method === 'HEAD') return response.end()
    createReadStream(sound.file, { start, end }).pipe(response)
  }
}
