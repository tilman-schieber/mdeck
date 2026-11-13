// What live ink does while the network is gone (room.js): it waits longer
// after each failed attempt, and the messages it holds stay few. Segments
// and finished strokes must all arrive, or the others keep a gap; the
// laser's dot and the zoom only say where they are now, so the last of each
// is enough.

const RETRY_MIN_MS = 250
const RETRY_MAX_MS = 5000
// Past this many held messages the oldest strokes in progress go first: a
// stroke drawn long ago in a dead WLAN is not worth a flood when it returns.
export const OUTBOX_LIMIT = 2000

// The wait before the next attempt after `failures` failed ones in a row.
export function retryDelay(failures) {
  return failures ? Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (failures - 1)) : 0
}

// One request to the stage room carries at most this many messages and, as
// far as they allow, this many bytes: below what a stage room accepts
// (MAX_INK in live/rooms.js; 64 KB on older servers). Moving strokes
// sends each of them whole: one line of handwriting can be more than that.
export const BATCH_COUNT = 100
export const BATCH_BYTES = 60000

// How many of the messages from the front go in the next request: at least
// one, so that a message larger than the bytes allowed still goes, alone.
export function batchSize(messages, { count = BATCH_COUNT, bytes = BATCH_BYTES } = {}) {
  let n = 0, total = 0
  for (const message of messages) {
    if (n === count) break
    total += JSON.stringify(message).length + 1
    if (n > 0 && total > bytes) break
    n++
  }
  return n
}

// The messages worth sending, in their order: only the last dot and zoom of
// each sender, and no more than `limit`, dropping the oldest segments first.
export function compactOutbox(messages, limit = OUTBOX_LIMIT) {
  const last = new Map()
  messages.forEach((message, i) => { if (message.type === 'dot' || message.type === 'zoom') last.set(`${message.type}:${message.key}`, i) })
  let kept = messages.filter((message, i) => !(message.type === 'dot' || message.type === 'zoom') || last.get(`${message.type}:${message.key}`) === i)
  let over = kept.length - limit
  if (over > 0) kept = kept.filter(message => !(message.type === 'segment' && over-- > 0))
  return kept
}
