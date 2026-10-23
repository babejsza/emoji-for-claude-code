// Shared patch logic for the VS Code extension, the CLI (bin/patch.mjs) and the
// uninstall hook. CommonJS and built-in modules only, so it runs everywhere.
//
// Safety:
//  - Our code is appended between two marker comments. Nothing of the original is
//    edited, so removing the block restores the file byte for byte.
//  - A pristine copy is kept next to the bundle as index.js.claude-better-chat.orig.
//  - A directory is only touched after its package.json proves it is
//    anthropic.claude-code. Directory names are never trusted on their own.
//  - Writes go to a unique temp file that is renamed over the target (atomic).
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
// Legacy names from the project's former name, "claude-better-chat". Installs patched by
// 0.1.x carry them, so they must never be renamed or those installs could not be cleaned up.
const BEGIN = '/* claude-better-chat:begin */'
const END = '/* claude-better-chat:end */'
const BACKUP_SUFFIX = '.claude-better-chat.orig'

const DATA_PLACEHOLDER = '/*EMOJI_DATA*/ {}'
const OPTIONS_PLACEHOLDER = '/*OPTIONS*/ {}'
const MESSAGE_BOX_HINT = '"aria-label":"Message input"'
// 0.1.0 wrote "/* v0.1.0 - ... */", later versions "/* emoji-for-claude-code v1.0.0 */"
const VERSION_RE = /\/\* (?:emoji-for-claude-code )?v(\d+\.\d+\.\d+)/

const version = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const bundlePath = (dir) => path.join(dir, 'webview', 'index.js')

function isClaudeCodeExtension(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return (
      String(pkg.publisher).toLowerCase() === 'anthropic' &&
      pkg.name === 'claude-code' &&
      fs.existsSync(bundlePath(dir))
    )
  } catch {
    return false
  }
}

// Every verified Claude Code install directly inside the given extension roots.
function findExtensions(roots) {
  const found = []
  for (const root of roots) {
    let names
    try {
      names = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      // VS Code unpacks into ".<uuid>" and deletes by renaming to "<name>.<hash>.vsctmp". Either may be half-written.
      if (name.startsWith('.') || name.endsWith('.vsctmp')) continue
      const dir = path.join(root, name)
      if (isClaudeCodeExtension(dir)) found.push(dir)
    }
  }
  return found
}

function strip(source, file) {
  const start = source.indexOf(BEGIN)
  if (start === -1) return source
  const end = source.indexOf(END, start)
  if (end === -1) {
    throw new Error(
      `the start marker was found in ${file} but the end marker is missing. ` +
        `Copy ${file}${BACKUP_SUFFIX} over it to restore the original`,
    )
  }
  // the block is always appended as "\n" + BEGIN ... END + "\n"
  const before = source.slice(0, start).replace(/\n$/, '')
  const after = source.slice(end + END.length).replace(/^\n/, '')
  return before + after
}

// The webview script with the emoji data and options inlined. Also used by the tests and asset renderer.
// options: { emoticons: boolean } (default true)
function inlineScript(options = {}) {
  const code = fs.readFileSync(path.join(ROOT, 'src', 'emoji-autocomplete.js'), 'utf8')
  for (const p of [DATA_PLACEHOLDER, OPTIONS_PLACEHOLDER]) {
    if (!code.includes(p)) throw new Error(`${p} not found in src/emoji-autocomplete.js`)
  }
  const data = fs.readFileSync(path.join(ROOT, 'src', 'emoji-data.json'), 'utf8')
  const opts = JSON.stringify({ emoticons: options.emoticons !== false })
  return code.replace(DATA_PLACEHOLDER, () => data).replace(OPTIONS_PLACEHOLDER, () => opts)
}

function buildBlock(options) {
  // Outer try/catch: even a runtime surprise at load stays inside our block.
  return `\n${BEGIN}\n/* emoji-for-claude-code v${version()} */\ntry{\n${inlineScript(options)}\n}catch(e){console.warn('[emoji-for-claude-code]',e)}\n${END}\n`
}

let tmpCounter = 0
function write(file, content) {
  // unique per process and call, so two VS Code windows never share a temp file
  const tmp = `${file}.emoji-for-claude-code-${process.pid}-${++tmpCounter}.tmp`
  try {
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, file)
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {}
    // without the unique temp name, so the same failure always reads the same
    throw Object.assign(new Error(`${error.code || 'error'}: cannot write ${file}`), { code: error.code })
  }
}

// Make sure a pristine copy exists. It is rebuilt if missing or if it is not pristine.
function ensureBackup(file, pristine) {
  const backup = file + BACKUP_SUFFIX
  try {
    if (!fs.readFileSync(backup, 'utf8').includes(BEGIN)) return
  } catch {}
  write(backup, pristine)
}

function assertTarget(dir) {
  if (!isClaudeCodeExtension(dir)) throw new Error(`not a Claude Code extension: ${dir}`)
}

// -> 'patched' | 'updated' | 'up-to-date', with options as for inlineScript()
function apply(dir, options) {
  assertTarget(dir)
  const file = bundlePath(dir)
  const source = fs.readFileSync(file, 'utf8')
  const pristine = strip(source, file)
  const next = pristine + buildBlock(options)
  if (next === source) return 'up-to-date'
  ensureBackup(file, pristine)
  write(file, next)
  return source.includes(BEGIN) ? 'updated' : 'patched'
}

// -> 'removed' | 'not-patched'
function remove(dir) {
  assertTarget(dir)
  const file = bundlePath(dir)
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes(BEGIN)) return 'not-patched'
  write(file, strip(source, file))
  return 'removed'
}

// -> { patched, version, messageBoxFound }
function status(dir) {
  assertTarget(dir)
  const source = fs.readFileSync(bundlePath(dir), 'utf8')
  const at = source.indexOf(BEGIN)
  const v = at === -1 ? null : VERSION_RE.exec(source.slice(at))
  return {
    patched: at !== -1,
    version: v ? v[1] : null,
    messageBoxFound: source.includes(MESSAGE_BOX_HINT),
  }
}

module.exports = {
  BEGIN,
  END,
  BACKUP_SUFFIX,
  isClaudeCodeExtension,
  findExtensions,
  inlineScript,
  apply,
  remove,
  status,
  version,
}
