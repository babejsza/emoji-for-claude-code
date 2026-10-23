// extension.js against a minimal stand-in for the VS Code API: consent, settings, commands, warnings.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import patcher from '../lib/patcher.js'

const require = createRequire(import.meta.url)
const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension.js')
const tick = () => new Promise((r) => setTimeout(r, 30))

// Every temp dir is recorded here when created and removed by exactly that path.
const created = []
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function fakeClaude() {
  const root = mkdtempSync(join(tmpdir(), 'efcc-consent-'))
  created.push(root)
  const dir = join(root, 'anthropic.claude-code-9.9.9')
  mkdirSync(join(dir, 'webview'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"publisher":"Anthropic","name":"claude-code"}')
  writeFileSync(join(dir, 'webview', 'index.js'), 'console.log("app");\n')
  return dir
}

// Loads a fresh copy of extension.js with `vscode` replaced and activates it.
// Pass `state` from an earlier start to simulate restarting VS Code.
function start({ state = new Map(), claude = fakeClaude(), cfg = {} } = {}) {
  const defaults = { enabled: true, convertEmoticons: true }
  const settings = { ...defaults, ...cfg }
  const prompts = []
  const infos = []
  const warnings = []
  const configListeners = []
  const changeListeners = []
  const commands = {}
  const vscode = {
    extensions: {
      getExtension: (id) => (id === 'anthropic.claude-code' ? { extensionPath: claude, packageJSON: { version: '9.9.9' } } : undefined),
      onDidChange: (fn) => (changeListeners.push(fn), { dispose() {} }),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) => (key in settings ? settings[key] : fallback),
        update: async (key, value) => {
          settings[key] = value === undefined ? defaults[key] : value
          const e = { affectsConfiguration: (s) => s === 'emojiForClaudeCode' || s === `emojiForClaudeCode.${key}` }
          for (const fn of configListeners) fn(e)
        },
      }),
      onDidChangeConfiguration: (fn) => (configListeners.push(fn), { dispose() {} }),
    },
    window: {
      showInformationMessage: (message, ...buttons) => {
        if (buttons.includes('Apply')) return new Promise((resolve) => prompts.push({ message, buttons, resolve }))
        infos.push(message)
        return Promise.resolve(undefined)
      },
      showWarningMessage: (message) => (warnings.push(message), Promise.resolve(undefined)),
    },
    commands: {
      registerCommand: (id, fn) => ((commands[id] = fn), { dispose() {} }),
      executeCommand: async () => {},
    },
    ConfigurationTarget: { Global: 1 },
  }
  const original = Module._load
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscode : original.call(this, request, ...rest)
  }
  let extension
  try {
    delete require.cache[require.resolve(EXTENSION)]
    extension = require(EXTENSION)
  } finally {
    Module._load = original
  }
  const globalState = {
    get: (key) => state.get(key),
    update: async (key, value) => void (value === undefined ? state.delete(key) : state.set(key, value)),
  }
  extension.activate({ globalState, subscriptions: [] })
  const run = (name) => commands[`emojiForClaudeCode.${name}`]()
  const setting = (key, value) => vscode.workspace.getConfiguration().update(key, value)
  // what VS Code does when any extension is installed or updated
  const changed = () => changeListeners.forEach((fn) => fn())
  return { claude, state, prompts, infos, warnings, run, setting, changed }
}
const patched = (dir) => patcher.status(dir).patched
const bundleText = (dir) => readFileSync(join(dir, 'webview', 'index.js'), 'utf8')

// An older Claude Code version that VS Code has not deleted yet, next to the running one.
function fakeSibling(claude) {
  const dir = join(dirname(claude), 'anthropic.claude-code-9.9.8')
  mkdirSync(join(dir, 'webview'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"publisher":"Anthropic","name":"claude-code"}')
  writeFileSync(join(dir, 'webview', 'index.js'), 'console.log("old");\n')
  return dir
}

test('other Claude Code versions are not touched before Apply either', async () => {
  const claude = fakeClaude()
  const old = fakeSibling(claude)
  const s = start({ claude })
  await tick()
  assert.ok(!patched(old))
  s.prompts[0].resolve('Apply')
  await tick()
  assert.ok(patched(claude) && patched(old))
})

test('first start asks once and changes nothing until Apply', async () => {
  const s = start()
  await tick()
  assert.equal(s.prompts.length, 1)
  assert.deepEqual(s.prompts[0].buttons, ['Apply', 'Not now'])
  assert.ok(!patched(s.claude))

  s.prompts[0].resolve('Apply')
  await tick()
  assert.ok(patched(s.claude))
  assert.equal(s.state.get('consentedToPatch'), true)
  assert.ok(s.infos.some((m) => m.includes('Reload the window')))

  const again = start({ state: s.state, claude: s.claude })
  await tick()
  assert.equal(again.prompts.length, 0, 'asked again after consent')
})

test('Not now is remembered, Enable still works, and switching the setting on asks again', async () => {
  const s = start()
  await tick()
  s.prompts[0].resolve('Not now')
  await tick()
  assert.ok(!patched(s.claude))

  await s.setting('enabled', false)
  await s.setting('enabled', true)
  await tick()
  assert.equal(s.prompts.length, 2, 'turning the setting on in the same session should ask again')
  s.prompts[1].resolve('Not now')
  await tick()

  const restarted = start({ state: s.state, claude: s.claude })
  await tick()
  assert.equal(restarted.prompts.length, 0, 'asked again at startup after Not now')

  await restarted.setting('enabled', false)
  await restarted.setting('enabled', true)
  await tick()
  assert.equal(restarted.prompts.length, 1, 'turning the setting on should ask again')
  restarted.prompts[0].resolve('Not now')
  await tick()

  await restarted.run('enable')
  await tick()
  assert.ok(patched(restarted.claude), 'Enable is an explicit yes')
})

test('closing the question without an answer asks again at the next start', async () => {
  const s = start()
  await tick()
  s.prompts[0].resolve(undefined)
  await tick()
  const restarted = start({ state: s.state, claude: s.claude })
  await tick()
  assert.equal(restarted.prompts.length, 1)
})

test('a second question is never stacked on an open one', async () => {
  const s = start()
  await tick()
  await s.setting('enabled', false)
  await s.setting('enabled', true)
  await tick()
  assert.equal(s.prompts.length, 1)
})

test('convertEmoticons and Disable reach Claude Code', async () => {
  const s = start({ state: new Map([['consentedToPatch', true]]) })
  await tick()
  assert.ok(bundleText(s.claude).includes('{"emoticons":true}'))
  await s.run('status')
  assert.ok(s.infos.some((m) => /is applied to Claude Code 9\.9\.9/.test(m)), s.infos.join('|'))
  await s.setting('convertEmoticons', false)
  await tick()
  assert.ok(bundleText(s.claude).includes('{"emoticons":false}'))
  await s.run('disable')
  await tick()
  assert.ok(!patched(s.claude))
  await s.run('status')
  assert.ok(s.infos.some((m) => /is not applied to Claude Code 9\.9\.9/.test(m)), s.infos.join('|'))
})

test('clicking Apply in a second window still offers a reload', async () => {
  const state = new Map()
  const claude = fakeClaude()
  const first = start({ state, claude })
  const second = start({ state, claude })
  await tick()
  first.prompts[0].resolve('Apply')
  await tick()
  second.prompts[0].resolve('Apply')
  await tick()
  assert.ok(second.infos.some((m) => m.includes('Reload the window')), second.infos.join('|'))
})

test('Show Status words an unreadable file as a read problem', async () => {
  const claude = fakeClaude()
  const s = start({ state: new Map([['consentedToPatch', true]]), claude })
  await tick()
  // swap the bundle for a directory: still identified as Claude Code, but no longer readable as a file
  rmSync(join(claude, 'webview', 'index.js'))
  mkdirSync(join(claude, 'webview', 'index.js'))
  await s.run('status')
  assert.match(s.warnings.at(-1), /could not read Claude Code's files/)
})

test('a broken Claude Code file warns once in the background but again on an explicit command', async () => {
  const claude = fakeClaude()
  writeFileSync(join(claude, 'webview', 'index.js'), `a()\n${patcher.BEGIN}\nno end marker`)
  const s = start({ state: new Map([['consentedToPatch', true]]), claude })
  await tick()
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0], /end marker is missing/)
  s.changed()
  s.changed()
  await tick()
  assert.equal(s.warnings.length, 1, 'background syncs repeated the same warning')
  await s.setting('convertEmoticons', false)
  await tick()
  assert.equal(s.warnings.length, 2, 'a settings change is explicit and should report again')
  await s.run('status')
  await tick()
  assert.equal(s.warnings.length, 2, 'status reads the file, which is fine here')
})
