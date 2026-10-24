// The answers kept in a talk (<deck>.results.json, results.js) read against
// the deck they were given in: which slide asked, what, and how it came out.
// `mdeck results` and the launch page export them from here, as the answers
// one by one (CSV), one row per option, word or number (summary CSV), or
// all of it (JSON).
//
// The summary counts as the slide does: for a poll, a scale, a number and a
// word cloud, each phone's latest answer; for open questions, every answer. Phones stay numbered per question; no device ids are kept.
// A tap on a picture (<pinpoint>) is written as "62.1% 31.4%".
import { tagsIn } from './tags.js'
import { expandPollLists, pollChoices } from './pollList.js'
import { choicesOf } from '../components/inlineText.js'
import { parseNumber, groupNumbers } from '../components/numbers.js'
import { tapOf, tapText, circleOf, isInside } from '../components/pinpoint.js'

const KINDS = { poll: 'poll', scale: 'scale', numeric: 'number', wordcloud: 'words', question: 'question', pinpoint: 'spot' }

const plain = text => String(text ?? '').replace(/\$([^$]+)\$/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()

function headingOf(slide) {
  const heading = String(slide?.content ?? '').replace(/^(```|~~~)[\s\S]*?^\1/gm, '').match(/^\s*#{1,3}\s+(.+?)\s*#*\s*$/m)?.[1]
  return heading ? plain(heading) : plain(slide?.meta?.title ?? '')
}

const scaleBounds = ({ min, max }) => {
  const low = Number.isFinite(Number(min)) && min !== '' && min != null ? Math.round(Number(min)) : 1
  const high = Number.isFinite(Number(max)) && max !== '' && max != null ? Math.round(Number(max)) : 5
  return high > low && high - low <= 10 ? [low, high] : [1, 5]
}

/**
 * The activities of a parsed deck, in order: [{ room, slide, kind, tag,
 * question, options?, multiple?, min?, max? }]. `slide` counts from 1; a
 * room asked on several slides is listed where it is first asked.
 */
export function activitiesIn(deck) {
  const found = new Map()
  ;(deck?.slides ?? []).forEach((slide, i) => {
    const texts = [slide.content ?? '', ...Object.values(slide.regions ?? {}).map(region => region.content ?? '')]
    for (const text of texts) {
      for (const tag of tagsIn(expandPollLists(text))) {
        const room = tag.attrs.room
        if (tag.closing || !room || found.has(room)) continue
        const kind = KINDS[tag.name] ?? tag.name
        const entry = { room, slide: i + 1, kind, tag: tag.name, question: plain(tag.attrs.question) || headingOf(slide) }
        if (tag.name === 'poll') {
          const listed = tag.attrs['data-choices'] != null && pollChoices(tag.attrs['data-choices'])
          entry.options = listed ? listed.map(choice => choice.text) : choicesOf(tag.attrs.options)
          if (tag.attrs.multiple != null && tag.attrs.multiple !== 'false') entry.multiple = true
        }
        if (tag.name === 'scale') [entry.min, entry.max] = scaleBounds(tag.attrs)
        found.set(room, entry)
      }
    }
  })
  return [...found.values()]
}

// Each phone's last answer, in the order the phones first answered.
function latestPerPhone(answers) {
  const latest = new Map()
  for (const answer of answers) latest.set(answer.phone, answer)
  return [...latest.values()]
}

const round = value => Math.round(value * 100) / 100
function stats(values) {
  if (!values.length) return {}
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return { average: round(values.reduce((sum, value) => sum + value, 0) / values.length), median: round(median), lowest: sorted[0], highest: sorted.at(-1) }
}

/**
 * How one activity came out: { phones, answers, counts: [{ answer, count }], average?, median?, lowest?, highest? }.
 * `solution` is the right answer the slide kept: a <pinpoint>'s circle,
 * which says how many taps were on target.
 */
export function summarize(activity, answers = [], solution = null) {
  const phones = new Set(answers.map(answer => answer.phone)).size
  const base = { phones, answers: answers.length }
  const tag = activity?.tag
  if (tag === 'poll') {
    const options = activity.options ?? []
    const votes = latestPerPhone(answers)
      .map(answer => activity.multiple ? (Array.isArray(answer.value) ? answer.value : [answer.value]) : (Array.isArray(answer.value) ? [] : [answer.value]))
      .map(picks => picks.filter(pick => options.includes(pick)))
      .filter(picks => picks.length)
    return { ...base, voted: votes.length, counts: options.map(option => ({ answer: option, count: votes.filter(picks => picks.includes(option)).length })) }
  }
  if (tag === 'scale') {
    const steps = Array.from({ length: activity.max - activity.min + 1 }, (_, i) => activity.min + i)
    const values = latestPerPhone(answers).map(answer => Number(answer.value)).filter(value => steps.includes(value))
    return { ...base, voted: values.length, counts: steps.map(step => ({ answer: String(step), count: values.filter(value => value === step).length })), ...stats(values) }
  }
  if (tag === 'pinpoint') {
    const taps = latestPerPhone(answers).map(answer => tapOf(answer.value)).filter(Boolean)
    const circle = circleOf(solution)
    const inside = circle ? taps.filter(tap => isInside(tap, circle)).length : 0
    return { ...base, voted: taps.length, counts: circle ? [{ answer: 'on target', count: inside }, { answer: 'off target', count: taps.length - inside }] : [] }
  }
  if (tag === 'numeric') {
    const texts = latestPerPhone(answers).map(answer => answer.value).filter(value => parseNumber(value) != null)
    return { ...base, voted: texts.length, counts: groupNumbers(texts).map(group => ({ answer: group.text, count: group.n })), ...stats(texts.map(parseNumber)) }
  }
  // Words (each phone's latest) and open answers (every one), the same words together.
  const counts = new Map()
  for (const answer of tag === 'wordcloud' ? latestPerPhone(answers) : answers) {
    const text = String(answer.value ?? '').trim().replace(/\s+/g, ' ')
    if (!text) continue
    const key = text.toLocaleLowerCase()
    const entry = counts.get(key) ?? { answer: text, count: 0 }
    entry.count++
    counts.set(key, entry)
  }
  return { ...base, counts: [...counts.values()].sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer)) }
}

/**
 * The kept answers against the deck: [{ room, slide, kind, question,
 * closed, savedAt, summary, answers }], in the order of the slides; rooms
 * the deck no longer asks come last, with what is known of them.
 */
export function resultsReport(results, deck) {
  const rooms = results?.rooms ?? {}
  const activities = activitiesIn(deck)
  const asked = activities.filter(activity => rooms[activity.room])
  const gone = Object.keys(rooms).filter(room => !activities.some(activity => activity.room === room)).map(room => ({ room, slide: null, kind: null, tag: null, question: '' }))
  return [...asked, ...gone].map(activity => {
    const entry = rooms[activity.room]
    const { tag, options, multiple, min, max, ...shown } = activity
    return { ...shown, closed: entry.closed, savedAt: entry.savedAt, summary: summarize(activity, entry.answers, entry.solution), answers: entry.answers }
  })
}

const csvCell = value => {
  const text = value == null ? '' : Array.isArray(value) ? value.join('|') : tapOf(value) ? tapText(tapOf(value)) : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const csv = rows => rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n'

/** Every answer with its question: slide, room, kind, question, phone, time, answer (several picks joined by |). */
export function reportAnswersCsv(report) {
  const rows = [['slide', 'room', 'kind', 'question', 'phone', 'at', 'answer']]
  for (const entry of report) for (const answer of entry.answers) rows.push([entry.slide, entry.room, entry.kind, entry.question, answer.phone, answer.at, answer.value])
  return csv(rows)
}

/** One row per option, step, number or word: slide, room, kind, question, answer, count, and its share of the phones that answered. */
export function reportSummaryCsv(report) {
  const rows = [['slide', 'room', 'kind', 'question', 'answer', 'count', 'share']]
  for (const entry of report) {
    const { counts = [], voted } = entry.summary
    const total = voted ?? counts.reduce((sum, row) => sum + row.count, 0)
    for (const row of counts) rows.push([entry.slide, entry.room, entry.kind, entry.question, row.answer, row.count, total ? `${Math.round((row.count / total) * 100)}%` : ''])
    for (const key of ['average', 'median']) if (entry.summary[key] != null) rows.push([entry.slide, entry.room, entry.kind, entry.question, key, entry.summary[key], ''])
  }
  return csv(rows)
}

/** All of it, for other programs: the deck's title, when, and each question with its summary and answers. */
export function reportJson(report, { title = '', exportedAt = new Date().toISOString() } = {}) {
  return JSON.stringify({ version: 1, title, exportedAt, questions: report }, null, 2) + '\n'
}
