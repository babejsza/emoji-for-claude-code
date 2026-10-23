#!/usr/bin/env node
// Command-line alternative to the VS Code extension (same patch, see lib/patcher.js).
const USAGE = `usage: node bin/patch.mjs [apply|status|remove] [--dir <extension dir>] [--no-emoticons] [--quiet] [--help]

  apply            add or update the emoji script in every installed Claude Code (default)
  status           show which installs are patched
  remove           remove the emoji script again
  --dir            target exactly one Claude Code extension directory (also --dir=<path>)
  --no-emoticons   don't turn emoticons such as :) and :P into emoji (apply only)
  --quiet          print only changes and errors (status always prints)`

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import patcher from '../lib/patcher.js'

const EXTENSION_ROOTS = [
  '.vscode/extensions',
  '.vscode-insiders/extensions',
  '.cursor/extensions',
  '.windsurf/extensions',
].map((p) => join(homedir(), p))

function fail(message) {
  console.error(`${message}\n\n${USAGE}`)
  process.exit(2)
}

let command = null
let dirArg = null
let quiet = false
let emoticons = true
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--help' || a === '-h') {
    console.log(USAGE)
    process.exit(0)
  } else if (a === '--quiet') quiet = true
  else if (a === '--no-emoticons') emoticons = false
  else if (a === '--dir') {
    dirArg = args[++i]
    if (!dirArg || dirArg.startsWith('--')) fail('--dir needs a path')
  } else if (a.startsWith('--dir=')) {
    dirArg = a.slice('--dir='.length)
    if (!dirArg) fail('--dir needs a path')
  } else if (a.startsWith('-')) fail(`unknown option: ${a}`)
  else if (command) fail(`unexpected argument: ${a}`)
  else if (['apply', 'status', 'remove'].includes(a)) command = a
  else fail(`unknown command: ${a}`)
}
command ??= 'apply'
const log = (...m) => !quiet && console.log(...m)

let extensions
if (dirArg !== null) {
  const dir = resolve(dirArg)
  if (!patcher.isClaudeCodeExtension(dir)) {
    console.error(`not a Claude Code extension: ${dir}`)
    process.exit(1)
  }
  extensions = [dir]
} else {
  extensions = patcher.findExtensions(EXTENSION_ROOTS)
}
if (!extensions.length) {
  ;(command === 'status' ? console.log : log)('no Claude Code extension found in', EXTENSION_ROOTS.join(', '))
  process.exit(0)
}

let failed = 0
for (const dir of extensions) {
  const label = dir.replace(homedir(), '~')
  try {
    if (command === 'status') {
      const s = patcher.status(dir)
      console.log(`${s.patched ? `patched (v${s.version ?? '?'})` : 'not patched'}  ${label}`)
      if (s.patched && !s.messageBoxFound)
        console.log('  warning: this Claude Code build looks different, so suggestions may not appear')
    } else if (command === 'remove') {
      const r = patcher.remove(dir)
      if (r === 'removed') console.log(`removed          ${label}  (reload the VS Code window)`)
      else log(`not patched      ${label}`)
    } else {
      const r = patcher.apply(dir, { emoticons })
      if (r === 'up-to-date') log(`up to date       ${label}`)
      else console.log(`${r.padEnd(16)} ${label}  (reload the VS Code window)`)
    }
  } catch (error) {
    failed++
    console.error(`error            ${label}: ${error.message}`)
  }
}
process.exitCode = failed ? 1 : 0
