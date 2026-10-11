import { diagnostic, scanDirectives } from './source.js'
import { isPlainObject, RENAMED_DECK_KEYS } from './parseSlides.js'
import { palettesFor } from '../extensions/tokens.js'
import { LABEL_KEYS, CALLOUT_TYPES } from './labels.js'
import { resolveLayoutProps, propertyErrors } from '../layouts/layoutProps.js'
import { movedHint } from '../extensions/moved.js'
import { paramValue } from '../extensions/params.js'

// Hotspots (runtime/hotspots.js): the deck's setting and a slide's own.
const HOTSPOT_SETTINGS = ['auto', 'marked', 'off', true, false]

// `layouts`, `themes` and `palettes` are manifest maps from the extension
// registry (see src/extensions/discover.js). Checks for a kind are skipped when
// its map is not supplied.
export function validateDeck(deck, { layouts = null, themes = null, palettes = null } = {}) {
  const diagnostics = [...deck.diagnostics]
  const add = (code, message, offset, severity) => diagnostics.push(diagnostic(deck.source, code, message, offset, severity))
  const config = deck.deckConfig
  for (const key of ['width', 'height']) {
    if (config[key] != null && (typeof config[key] !== 'number' || !Number.isFinite(config[key]) || config[key] <= 0)) add('invalid-config', `${key} must be a positive number`, deck.configSource?.start)
  }
  for (const [old, now] of Object.entries(RENAMED_DECK_KEYS)) {
    if (config[old] != null) add('renamed-setting', `${old} is now ${now}${old === 'live' ? ': the address is server, and id and code are session.id and session.code' : ''}`, deck.configSource?.start)
  }
  // Colours come only from the palette now.
  for (const key of ['accent', 'accent2']) {
    if (config[key] != null) add('removed-setting', `${key} is no longer a setting: colours come from the palette; choose one with palette (see mdeck list palettes)`, deck.configSource?.start)
  }
  if (config.appearance != null && !['light', 'dark'].includes(config.appearance)) add('invalid-config', 'appearance must be light or dark', deck.configSource?.start)
  for (const key of ['meta', 'params', 'callouts', 'labels', 'show', 'reader', 'session']) {
    if (config[key] != null && !isPlainObject(config[key])) add('invalid-config', `${key} must be a mapping`, deck.configSource?.start)
  }
  if (isPlainObject(config.reader)) {
    for (const key of Object.keys(config.reader)) if (!['themes', 'notes'].includes(key)) add('invalid-config', `reader.${key} is not a setting; available: themes, notes`, deck.configSource?.start, 'warning')
    for (const key of ['themes', 'notes']) if (config.reader[key] != null && typeof config.reader[key] !== 'boolean') add('invalid-config', `reader.${key} must be true or false`, deck.configSource?.start)
  }
  if (config.components != null && (!Array.isArray(config.components) || config.components.some(path => typeof path !== 'string' || !path.trim()))) add('invalid-config', 'components must be a list of folder paths', deck.configSource?.start)
  if (config.lang != null && (typeof config.lang !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(config.lang))) add('invalid-config', 'lang must be a language code such as en, de or de-CH', deck.configSource?.start)
  if (isPlainObject(config.labels)) {
    for (const [key, value] of Object.entries(config.labels)) {
      if (!LABEL_KEYS.includes(key)) add('invalid-config', `labels.${key} is not a label; see the authoring reference for the list`, deck.configSource?.start, 'warning')
      else if (typeof value !== 'string') add('invalid-config', `labels.${key} must be text`, deck.configSource?.start)
    }
  }
  // References: bibliography.js reads the files and reports what it cannot use.
  if (config.bibliography != null && ![config.bibliography].flat().every(file => typeof file === 'string' && file.trim())) add('invalid-config', 'bibliography must be a file name such as refs.bib, or a list of them', deck.configSource?.start)
  if (config.csl != null && (typeof config.csl !== 'string' || !config.csl.trim())) add('invalid-config', 'csl must be a style name (apa, vancouver, harvard1) or a .csl file', deck.configSource?.start)
  if (config.nocite != null && (!Array.isArray(config.nocite) || config.nocite.some(key => typeof key !== 'string'))) add('invalid-config', "nocite must be a list of reference keys, or ['*'] for all", deck.configSource?.start)
  if (config.server != null && (typeof config.server !== 'string' || !/^https?:\/\//.test(config.server))) add('invalid-config', 'server must be an http:// or https:// address', deck.configSource?.start)
  // The countdown's end sounds (src/runtime/timer.js): named files, or a list of files.
  if (config.timer != null) {
    if (!isPlainObject(config.timer)) add('invalid-config', 'timer must be a mapping, such as timer: { sounds: { Gong: ./sounds/gong.mp3 } }', deck.configSource?.start)
    else {
      for (const key of Object.keys(config.timer)) if (key !== 'sounds') add('invalid-config', `timer.${key} is not a setting; available: sounds`, deck.configSource?.start, 'warning')
      const sounds = config.timer.sounds
      const files = Array.isArray(sounds) ? sounds : isPlainObject(sounds) ? Object.values(sounds) : null
      if (sounds != null && (!files || !files.every(file => typeof file === 'string' && file.trim()))) add('invalid-config', 'timer.sounds must name sound files (Gong: ./sounds/gong.mp3) or list them', deck.configSource?.start)
    }
  }
  if (isPlainObject(config.session)) {
    for (const key of Object.keys(config.session)) if (!['id', 'code'].includes(key)) add('invalid-config', `session.${key} is not a setting; available: id, code`, deck.configSource?.start, 'warning')
    if (config.session.code != null && !/^\d{4,8}$/.test(String(config.session.code))) add('invalid-config', 'session.code must be 4 to 8 digits', deck.configSource?.start)
  }
  if (config.hotspots != null && !HOTSPOT_SETTINGS.includes(config.hotspots)) add('invalid-config', 'hotspots must be auto, marked, off, true or false', deck.configSource?.start)
  const enums = { organization: ['title', 'all', 'none'], author: ['title', 'all', 'none'], numbers: ['slides', 'all', 'none'], sections: ['all', 'none'] }
  const switches = ['citations']
  if (isPlainObject(config.show)) {
    for (const key of Object.keys(config.show)) if (!Object.hasOwn(enums, key) && !switches.includes(key)) add('invalid-config', `show.${key} is not a setting; available: ${[...Object.keys(enums), ...switches].join(', ')}`, deck.configSource?.start, 'warning')
    for (const key of switches) if (config.show[key] != null && typeof config.show[key] !== 'boolean') add('invalid-config', `show.${key} must be true or false`, deck.configSource?.start)
    for (const [key, values] of Object.entries(enums)) {
      if (config.show[key] != null && !values.includes(config.show[key])) add('invalid-config', `show.${key} must be one of: ${values.join(', ')}`, deck.configSource?.start)
    }
  }
  if (themes && config.theme != null && !Object.hasOwn(themes, config.theme)) add('unknown-theme', movedHint('theme', config.theme) ?? `Unknown theme "${config.theme}"; available: ${Object.keys(themes).join(', ') || 'none'}. mdeck themes search lists more to install`, deck.configSource?.start)
  if (themes && config.theme == null && !Object.hasOwn(themes, 'neue')) add('unknown-theme', `This deck sets no theme, so it uses neue, which is not installed: run mdeck themes install neue, or set a theme${Object.keys(themes).length ? ` (${Object.keys(themes).join(', ')})` : ''}`, deck.configSource?.start ?? 0)
  if (palettes && themes && config.palette != null) {
    const theme = themes[config.theme ?? 'neue']
    const offered = theme ? palettesFor(theme, palettes).map(palette => palette.id) : Object.keys(palettes)
    if (!Object.hasOwn(palettes, config.palette)) add('unknown-palette', movedHint('palette', config.palette) ?? `Unknown palette "${config.palette}"; available: ${offered.join(', ')}`, deck.configSource?.start)
    else if (theme && !offered.includes(config.palette)) add('unknown-palette', `The theme "${theme.id}" does not offer the palette "${config.palette}"; available: ${offered.join(', ')}`, deck.configSource?.start)
  }
  if (themes && config.params != null && isPlainObject(config.params) && Object.hasOwn(themes, config.theme ?? 'neue')) {
    const theme = themes[config.theme ?? 'neue']
    for (const [name, value] of Object.entries(config.params)) {
      const param = theme.params?.[name]
      if (!param) { add('unknown-param', `Theme "${theme.id}" has no parameter "${name}"; available: ${Object.keys(theme.params ?? {}).join(', ') || 'none'}`, deck.configSource?.start, 'warning'); continue }
      const result = paramValue(param, value)
      if (result.problem) add('invalid-param', `params.${name} ${result.problem}; the theme's ${param.default} is used instead`, deck.configSource?.start, 'warning')
      else if (result.note) add('invalid-param', `params.${name} ${result.note}; ${result.value} may not look right`, deck.configSource?.start, 'warning')
    }
  }
  // Callout types the deck names under `callouts:` are its own, on purpose.
  const calloutTypes = [...CALLOUT_TYPES, ...(isPlainObject(config.callouts) ? Object.keys(config.callouts).map(key => key.toLowerCase()) : [])]
  const ids = new Set()
  for (const slide of deck.slides) {
    const offset = slide.metaSource?.start ?? slide.source.start
    if (typeof slide.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(slide.id)) add('invalid-id', 'Slide IDs must start with a letter and contain letters, digits, hyphens or underscores', offset)
    if (ids.has(slide.id)) add('duplicate-id', `Duplicate slide ID "${slide.id}"`, offset)
    ids.add(slide.id)
    for (const key of ['note', 'notes']) {
      if (Object.hasOwn(slide.authoredMeta, key)) add('invalid-metadata', `${key} is not a slide setting; write speaker notes in a :::notes block`, offset)
    }
    for (const key of ['layout', 'title', 'image', 'alt', 'section', 'part', 'eyebrow', 'attribution']) {
      if (slide.meta[key] != null && typeof slide.meta[key] !== 'string') add('invalid-metadata', `${key} must be a string`, offset)
    }
    if (slide.meta.props != null && !isPlainObject(slide.meta.props)) add('invalid-props', 'props must be a mapping', offset)
    if (slide.meta.overlay != null && typeof slide.meta.overlay !== 'boolean') add('invalid-metadata', 'overlay must be true or false', offset)
    if (slide.meta.hotspots != null && !HOTSPOT_SETTINGS.includes(slide.meta.hotspots)) add('invalid-metadata', 'hotspots must be auto, marked, off, true or false', offset)
    for (const node of directivesIn(deck.source.slice(slide.source.start, slide.source.end))) {
      if (DIRECTIVES.includes(node.name) || calloutTypes.includes(node.name.toLowerCase())) continue
      const near = closest(node.name.toLowerCase(), [...DIRECTIVES, ...calloutTypes])
      add('unknown-callout', `Unknown block "${node.name}"${near ? `; did you mean "${near}"?` : ''} It shows as a plain callout. Known: ${CALLOUT_TYPES.join(', ')}; name your own under callouts: in the settings`, slide.source.start + node.start, 'warning')
    }
    if (!layouts) continue
    const layout = slide.meta.layout ?? 'generic'
    if (!Object.hasOwn(layouts, layout)) {
      add('unknown-layout', `Unknown layout "${layout}"; using the generic renderer`, offset, 'warning')
      continue
    }
    const manifest = layouts[layout]
    for (const [name, region] of Object.entries(slide.regions)) {
      if (region.explicit && !Object.hasOwn(manifest.regions, name)) add('unknown-region', `Layout "${layout}" has no region "${name}"`, region.source.start)
    }
    for (const [name, schema] of Object.entries(manifest.regions)) {
      if (schema.required && !slide.regions[name]?.content.trim()) add('missing-region', `Layout "${layout}" requires region "${name}"`, offset)
    }
    if (slide.meta.props != null && !isPlainObject(slide.meta.props)) continue
    const props = resolveLayoutProps(manifest, slide.meta)
    for (const [name, schema] of Object.entries(manifest.properties ?? {})) {
      if (props[name] === undefined) {
        if (schema.required) add('missing-property', `Layout "${layout}" requires props.${name}`, offset)
      } else for (const message of propertyErrors(props[name], schema, `props.${name}`)) add('invalid-property', message, offset)
    }
    for (const name of Object.keys(slide.meta.props ?? {})) {
      if (!Object.hasOwn(manifest.properties ?? {}, name)) add('unknown-property', `Layout "${layout}" has no property "${name}"`, offset)
    }
  }
  return diagnostics
}

// The `:::` blocks mdeck reads itself; any other name is a callout type.
const DIRECTIVES = ['meta', 'notes', 'slot', 'steps', 'columns']

function directivesIn(source) {
  const all = []
  const visit = nodes => { for (const node of nodes) { all.push(node); visit(node.children) } }
  visit(scanDirectives(source).nodes)
  return all
}

// The known name a misspelling is most likely meant to be: at most two
// letters added, left out or changed.
function closest(name, names) {
  const distance = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      const next = [i]
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      row = next
    }
    return row[b.length]
  }
  const [best] = names.map(candidate => [candidate, distance(name, candidate)]).sort((x, y) => x[1] - y[1])
  return best && best[1] <= 2 ? best[0] : null
}

export function formatDiagnostics(diagnostics, filename = 'slides.md') {
  return diagnostics.map(d => `${filename}:${d.line}:${d.column ?? 1}: ${d.severity} [${d.code}] ${d.message}`).join('\n')
}
