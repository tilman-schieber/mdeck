import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'

// Phones and tablets reach `mdeck dev --host` at http://192.168…, which is not
// a secure context: browsers leave out crypto.randomUUID there, and a page
// that calls it without a fallback fails to start (polls showed nothing on
// phones in 1.2). crypto.getRandomValues works everywhere.
const root = resolve(import.meta.dirname, '..')
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(jsx?|mjs)$/.test(name)) yield path
  }
}

test('browser code never calls crypto.randomUUID without a fallback', () => {
  const unguarded = []
  for (const file of files(resolve(root, 'src'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/crypto\.randomUUID\(\)/.test(line) && !/crypto\.randomUUID \?/.test(line)) unguarded.push(`${relative(root, file)}:${i + 1}`)
    })
  }
  assert.deepEqual(unguarded, [], 'use crypto.randomUUID?.() ?? a getRandomValues fallback')
})
