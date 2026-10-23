import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import patcher from '../lib/patcher.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = join(ROOT, 'bin', 'patch.mjs')
const cli = (...a) => spawnSync('node', [PATCH, ...a], { encoding: 'utf8' })
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

// Every temp dir is recorded here when created and removed by exactly that path.
const created = []
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'efcc-test-'))
  created.push(dir)
  return dir
}

// A fake Claude Code extension. Without an explicit source, EFCC_REAL_EXT (an installed extension
// dir) makes it use that real bundle instead.
function fixture(source, root = tempDir()) {
  const dir = join(root, 'anthropic.claude-code-9.9.9')
  mkdirSync(join(dir, 'webview'), { recursive: true })
  const real = source === undefined && process.env.EFCC_REAL_EXT
  if (real) {
    // an installed copy may already be patched, so start from the pristine backup then
    const bundle = join(real, 'webview', 'index.js')
    const pristine = existsSync(bundle + patcher.BACKUP_SUFFIX) ? bundle + patcher.BACKUP_SUFFIX : bundle
    cpSync(join(real, 'package.json'), join(dir, 'package.json'))
    cpSync(pristine, join(dir, 'webview', 'index.js'))
  } else {
    writeFileSync(join(dir, 'package.json'), '{"publisher":"Anthropic","name":"claude-code"}')
    writeFileSync(join(dir, 'webview', 'index.js'), source ?? 'console.log("app");\n')
  }
  return dir
}
const bundle = (dir) => join(dir, 'webview', 'index.js')
const read = (dir) => readFileSync(bundle(dir), 'utf8')

test('the legacy markers and backup name are pinned (installs patched by 0.1.x rely on them)', () => {
  assert.equal(patcher.BEGIN, '/* claude-better-chat:begin */')
  assert.equal(patcher.END, '/* claude-better-chat:end */')
  assert.equal(patcher.BACKUP_SUFFIX, '.claude-better-chat.orig')
})

test('the legacy history key is unchanged (users keep their most-used emoji)', () => {
  assert.ok(patcher.inlineScript().includes("'claude-better-chat.emoji.recent'"))
})

test('apply is idempotent, keeps a pristine backup and remove restores the file byte for byte', () => {
  const dir = fixture()
  const original = read(dir)

  assert.equal(patcher.apply(dir), 'patched')
  const once = read(dir)
  assert.ok(once.startsWith(original))
  assert.equal(readFileSync(bundle(dir) + patcher.BACKUP_SUFFIX, 'utf8'), original)
  assert.equal(patcher.apply(dir), 'up-to-date')
  assert.equal(read(dir), once)
  assert.deepEqual(patcher.status(dir), { patched: true, version: VERSION, messageBoxFound: !!process.env.EFCC_REAL_EXT })

  assert.equal(patcher.remove(dir), 'removed')
  assert.equal(read(dir), original)
  assert.equal(patcher.remove(dir), 'not-patched')
  assert.deepEqual(readdirSync(join(dir, 'webview')).filter((f) => f.endsWith('.tmp')), [], 'temp file left behind')
})

test('CRLF files and files without a final newline round-trip exactly', () => {
  for (const source of ['a();\r\nb();\r\n', 'a();\nb();', 'x']) {
    const dir = fixture(source)
    patcher.apply(dir)
    patcher.remove(dir)
    assert.equal(read(dir), source)
  }
})

test('an install patched by 0.1.0 is upgraded and can still be removed', () => {
  const original = 'console.log("app");\n'
  const legacy = `${original}\n${patcher.BEGIN}\n/* v0.1.0 - remove with: node bin/patch.mjs remove */\ntry{\nold()\n}catch(e){console.warn('[claude-better-chat]',e)}\n${patcher.END}\n`
  const dir = fixture(legacy)
  assert.equal(patcher.status(dir).version, '0.1.0')

  assert.equal(patcher.apply(dir), 'updated')
  const upgraded = read(dir)
  assert.equal(upgraded.split(patcher.BEGIN).length, 2, 'exactly one block')
  assert.ok(!upgraded.includes('old()'))
  assert.equal(patcher.status(dir).version, VERSION)
  // the fixture has no backup, so a pristine one is rebuilt from the stripped file
  assert.equal(readFileSync(bundle(dir) + patcher.BACKUP_SUFFIX, 'utf8'), original)

  patcher.remove(dir)
  assert.equal(read(dir), original)
})

test('a backup that is not pristine is replaced', () => {
  const dir = fixture()
  const original = read(dir)
  writeFileSync(bundle(dir) + patcher.BACKUP_SUFFIX, `${original}\n${patcher.BEGIN}\nbroken`)
  patcher.apply(dir)
  assert.equal(readFileSync(bundle(dir) + patcher.BACKUP_SUFFIX, 'utf8'), original)
})

test('a broken block names the file and the backup instead of guessing', () => {
  const dir = fixture(`a();\n${patcher.BEGIN}\nno end marker`)
  assert.throws(() => patcher.apply(dir), /end marker is missing.*claude-better-chat\.orig/)
})

test('the injected block contains the emoji data and is valid JavaScript', () => {
  const dir = fixture()
  patcher.apply(dir)
  const source = read(dir)
  const block = source.slice(source.indexOf(patcher.BEGIN))
  assert.ok(!block.includes('/*EMOJI_DATA*/'), 'placeholder not replaced')
  assert.ok(block.includes('["🚀",["rocket"'), 'emoji data missing')
  const copy = join(tempDir(), 'check.mjs')
  writeFileSync(copy, source)
  const check = spawnSync('node', ['--check', copy], { encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr)
})

test('emoji data: unique shortcodes, Slack owners win, and every name is typeable', () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'src', 'emoji-data.json'), 'utf8')).emoji
  assert.ok(data.length > 1800)
  const owner = new Map()
  for (const [emoji, names] of data) {
    for (const name of names) {
      assert.match(name, /^[a-z0-9_+-]+$/, `${emoji} has an untypeable name: ${name}`)
      assert.ok(!owner.has(name), `${name} is used by ${owner.get(name)} and ${emoji}`)
      owner.set(name, emoji)
    }
  }
  const expected = { train: '🚋', pencil: '📝', calendar: '📆', '+1': '👍', '-1': '👎', 'flag-pl': '🇵🇱', rocket: '🚀' }
  for (const [name, emoji] of Object.entries(expected)) assert.equal(owner.get(name), emoji, `:${name}:`)
})

test('emoticons: only the safe subset, and the setting reaches the injected script', () => {
  const { emoticons } = JSON.parse(readFileSync(join(ROOT, 'src', 'emoji-data.json'), 'utf8'))
  for (const [text, emoji] of Object.entries({ ':)': '🙂', ':D': '😄', ':P': '😛', ';)': '😉', '<3': '❤️', ":'(": '😢' }))
    assert.equal(emoticons[text], emoji, text)
  for (const risky of ['C:', 'D:', '8)', ':/', ':\\', '):', '(:', ':*', ':>', ':b', ':|', '=)', ':o)', '</3'])
    assert.ok(!(risky in emoticons), `${risky} must not convert`)

  assert.match(patcher.inlineScript(), /const OPTIONS = \{"emoticons":true\}/)
  assert.match(patcher.inlineScript({ emoticons: false }), /const OPTIONS = \{"emoticons":false\}/)
  const dir = fixture()
  patcher.apply(dir)
  assert.equal(patcher.apply(dir, { emoticons: false }), 'updated')
  assert.ok(read(dir).includes('{"emoticons":false}'))
  assert.equal(patcher.apply(dir, { emoticons: false }), 'up-to-date')
})

test('CLI: refuses a directory that is not Claude Code, rejects unknown options, reports status', () => {
  const dir = fixture()
  const other = join(tempDir(), 'someone.claude-code-1.0.0')
  mkdirSync(join(other, 'webview'), { recursive: true })
  writeFileSync(join(other, 'package.json'), '{"publisher":"someone","name":"claude-code"}')
  writeFileSync(join(other, 'webview', 'index.js'), 'x')

  const refused = cli('--dir', other)
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /not a Claude Code extension/)
  assert.equal(readFileSync(join(other, 'webview', 'index.js'), 'utf8'), 'x', 'refused dir was changed')

  const unknown = cli('--dri', dir)
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /unknown option: --dri/)

  assert.equal(cli(`--dir=${dir}`, '--quiet').status, 0)
  assert.ok(read(dir).includes('{"emoticons":true}'))
  assert.equal(cli('--dir', dir, '--no-emoticons', '--quiet').status, 0)
  assert.ok(read(dir).includes('{"emoticons":false}'), '--no-emoticons did not reach the script')
  assert.equal(cli('--dir', dir, '--quiet').status, 0)
  assert.ok(read(dir).includes('{"emoticons":true}'))
  const status = cli('status', '--dir', dir)
  assert.equal(status.status, 0)
  assert.match(status.stdout, new RegExp(`patched \\(v${VERSION.replace(/\./g, '\\.')}\\)`))
})

test('the uninstall hook removes the patch from Claude Code next to this extension', () => {
  const root = tempDir()
  const self = join(root, 'babejsza.emoji-for-claude-code-9.9.9')
  for (const f of ['package.json', 'uninstall.js', 'lib', 'src']) cpSync(join(ROOT, f), join(self, f), { recursive: true })
  const dir = fixture(undefined, root)
  const original = read(dir)
  patcher.apply(dir)

  const run = spawnSync('node', [join(self, 'uninstall.js')], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(read(dir), original)
})

test('findExtensions and the identity check accept only a real Claude Code install', () => {
  const root = tempDir()
  const make = (name, pkg, withBundle = true) => {
    const dir = join(root, name)
    mkdirSync(join(dir, 'webview'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), pkg)
    if (withBundle) writeFileSync(join(dir, 'webview', 'index.js'), 'x')
    return dir
  }
  const good = make('anthropic.claude-code-1.0.0', '{"publisher":"Anthropic","name":"claude-code"}')
  make('someone.claude-code-1.0.0', '{"publisher":"someone","name":"claude-code"}')
  make('anthropic.other-1.0.0', '{"publisher":"Anthropic","name":"other"}')
  make('anthropic.claude-code-2.0.0', '{"publisher":"Anthropic","name":"claude-code"}', false)
  make('broken-1.0.0', '{not json')
  writeFileSync(join(root, 'stray.txt'), 'x')
  // a folder named like something else still counts when its package.json says it is Claude Code
  const renamed = make('whatever', '{"publisher":"anthropic","name":"claude-code"}')
  // VS Code's half-extracted and half-deleted copies
  make('.0f3a9c1e-1111', '{"publisher":"anthropic","name":"claude-code"}')
  make('anthropic.claude-code-1.0.0.1a2b3c.vsctmp', '{"publisher":"anthropic","name":"claude-code"}')
  assert.deepEqual(patcher.findExtensions([root]).sort(), [good, renamed].sort())
  assert.deepEqual(patcher.findExtensions([join(root, 'missing')]), [])
})

test('CLI: an empty --dir= is an error, not "every install"', () => {
  const empty = cli('--dir=', 'status')
  assert.equal(empty.status, 2)
  assert.match(empty.stderr, /--dir needs a path/)
})

test('a failed write names the file, keeps the original and leaves no temp file', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const dir = fixture()
  const original = read(dir)
  const webview = join(dir, 'webview')
  chmodSync(webview, 0o555)
  try {
    assert.throws(() => patcher.apply(dir), (error) => error.code === 'EACCES' && /^EACCES: cannot write .*index\.js/.test(error.message))
  } finally {
    chmodSync(webview, 0o755)
  }
  assert.equal(read(dir), original)
  assert.deepEqual(readdirSync(webview), ['index.js'])
})
