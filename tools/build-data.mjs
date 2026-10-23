#!/usr/bin/env node
// Builds src/emoji-data.json from iamcal/emoji-data (MIT), the dataset with Slack's shortcodes.
// Usage: node tools/build-data.mjs path/to/emoji.json
//   (https://raw.githubusercontent.com/iamcal/emoji-data/<commit>/emoji.json, see CONTRIBUTING.md)
// Output: { emoji: [[emoji, [shortcode, ...]], ...] in iamcal's sort order, emoticons: { ':)': '🙂', ... } }
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = process.argv[2]
if (!src) {
  console.error('usage: node tools/build-data.mjs <iamcal emoji.json>')
  process.exit(1)
}

// Official Unicode name -> shortcode: accents and punctuation removed, words joined with "_",
// e.g. "THUMBS UP SIGN" -> thumbs_up_sign
const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\u2019'".!(),:]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9+]+/g, '_')
    .replace(/^_+|_+$/g, '')

const toEmoji = (unified) => String.fromCodePoint(...unified.split('-').map((h) => parseInt(h, 16)))

const db = JSON.parse(readFileSync(src, 'utf8'))
  .filter(
    // Skip components (bare skin-tone and hair-style modifiers). Skin-tone variants of other emoji
    // are not included either. Keep "obsoleted" entries: they are valid gender-neutral emoji such as
    // :runner:, which iamcal only flags because some vendors draw them as the gendered variant.
    (e) => e.category !== 'Component' && e.unified && e.short_names?.length,
  )
  .sort((a, b) => a.sort_order - b.sort_order)

// A Slack shortcode always wins: the official Unicode name is only added as an extra name when no
// emoji uses it as a shortcode and no earlier emoji already got it (e.g. "TRAIN" must not take :train:).
const taken = new Set(db.flatMap((e) => e.short_names))
const out = []
for (const e of db) {
  const names = [...e.short_names]
  const fromName = e.name ? slug(e.name) : ''
  if (fromName && !taken.has(fromName)) {
    names.push(fromName)
    taken.add(fromName)
  }
  out.push([toEmoji(e.unified), names])
}

// Only emoticons that are unlikely in a chat about code. Left out on purpose: C: and D: (drive
// letters), 8) (numbered lists), :/ and :\ (paths and URLs), ): and (: (code), :* :> :b :| =) :o) </3.
const SAFE_EMOTICONS = new Set([':)', ':-)', ':(', ':-(', ':D', ':-D', ':P', ':-P', ':p', ':-p', ';)', ';-)',
  ';P', ';-P', ';p', ';-p', ':O', ':-O', ':o', ':-o', ":'(", '>:(', '>:-(', ':-/', '<3'])
const emoticons = {}
for (const e of db) {
  for (const text of e.texts || []) if (SAFE_EMOTICONS.has(text)) emoticons[text] = toEmoji(e.unified)
}
const missing = [...SAFE_EMOTICONS].filter((t) => !emoticons[t])
if (missing.length) throw new Error(`emoticons not found in the source data: ${missing.join(' ')}`)

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'emoji-data.json')
writeFileSync(target, JSON.stringify({ emoji: out, emoticons }))
console.log(`wrote ${out.length} emoji and ${Object.keys(emoticons).length} emoticons to ${target}`)
