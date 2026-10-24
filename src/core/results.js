// The answers given during a talk, kept beside the deck as
// <deck>.results.json, so they outlast the room server (which forgets them)
// and show in builds, PDFs and files sent to readers.
//
//   { "version": 1, "rooms": { "<room>": { "savedAt": "…", "closed": false,
//     "answers": [{ "phone": 1, "at": "…", "value": … }], "solution": … } } }
//
// `solution` is the right answer as the slide knows it, where it has one:
// for a <pinpoint>, the circle measured on its picture.
//
// Phones are numbered per room in the order they first answered; their own
// ids never leave the room server. `answers` are those that counted: once an
// activity was closed, the ones before.

import { tapOf, tapText } from '../components/pinpoint.js'

export const resultsFileFor = deckPath => String(deckPath).replace(/\.md$/i, '') + '.results.json'

const ROOM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** One room's answers as kept: room messages ({ n, at, from, data }) with numbered phones. */
export function keptAnswers(messages) {
  const phones = new Map()
  return messages.map(message => {
    const from = message.from ?? `#${message.n}`
    if (!phones.has(from)) phones.set(from, phones.size + 1)
    return { phone: phones.get(from), at: message.at ?? null, value: message.data?.value ?? null }
  })
}

/** Kept answers as room messages again, for the slides that show them. */
export const answersAsMessages = answers => answers.map((answer, i) => ({ n: i + 1, at: answer.at, from: `phone-${answer.phone}`, data: { value: answer.value } }))

/** A results file as read, with anything unexpected left out. */
export function normalizeResults(data) {
  const rooms = {}
  for (const [room, entry] of Object.entries(data?.rooms ?? {})) {
    if (!ROOM_RE.test(room) || !Array.isArray(entry?.answers)) continue
    rooms[room] = {
      savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : null,
      closed: !!entry.closed,
      answers: entry.answers.filter(answer => answer && Number.isInteger(answer.phone)).map(({ phone, at, value }) => ({ phone, at: typeof at === 'string' ? at : null, value: value ?? null })),
      ...(entry.solution != null && typeof entry.solution === 'object' ? { solution: entry.solution } : {}),
    }
  }
  return { version: 1, rooms }
}

/** One room's answers in, or (none) out; returns the new results. */
export function withRoom(results, room, { answers, closed = false, solution = null, savedAt = new Date().toISOString() }) {
  if (!ROOM_RE.test(room)) throw Object.assign(new Error('Room names use letters, digits, dots, hyphens and underscores'), { status: 400 })
  const rooms = { ...results.rooms }
  if (Array.isArray(answers) && answers.length) rooms[room] = { savedAt, closed: !!closed, answers, solution }
  else delete rooms[room]
  return normalizeResults({ rooms })
}

export const serializeResults = results => JSON.stringify(results, null, 2) + '\n'

const csvCell = value => {
  const text = value == null ? '' : Array.isArray(value) ? value.join('|') : tapOf(value) ? tapText(tapOf(value)) : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** All answers as CSV: room, phone, time, answer (several picks joined by |). */
export function resultsCsv(results) {
  const rows = [['room', 'phone', 'at', 'answer']]
  for (const [room, entry] of Object.entries(results.rooms)) for (const answer of entry.answers) rows.push([room, answer.phone, answer.at, answer.value])
  return rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n'
}
