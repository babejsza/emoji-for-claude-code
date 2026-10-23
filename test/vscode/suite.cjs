// Runs inside the VS Code extension host started by test/vscode/run.mjs.
// A tiny runner instead of mocha keeps the dev tree small.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vscode = require('vscode')
const patcher = require('../../lib/patcher')

const SELF_ID = 'babejsza.emoji-for-claude-code'
const CLAUDE_ID = 'anthropic.claude-code'

async function waitFor(check, what, ms = 20000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`timed out waiting for: ${what}`)
}

const bundle = (dir) => path.join(dir, 'webview', 'index.js')
let claudeDir

const tests = [
  ['Claude Code is installed in the test instance', async () => {
    const claude = vscode.extensions.getExtension(CLAUDE_ID)
    assert.ok(claude, 'anthropic.claude-code not found')
    claudeDir = claude.extensionPath
    console.log(`    Claude Code ${claude.packageJSON.version}, VS Code ${vscode.version}`)
  }],

  ['extension activates', async () => {
    const self = vscode.extensions.getExtension(SELF_ID)
    assert.ok(self, `${SELF_ID} not found`)
    await self.activate()
    assert.ok(self.isActive)
  }],

  ['does not touch Claude Code before the user agrees', async () => {
    // the consent prompt is open and unanswered in the test instance
    await new Promise((r) => setTimeout(r, 2000))
    assert.ok(!patcher.status(claudeDir).patched, 'patched without consent')
  }],

  ['Enable (explicit consent) patches Claude Code', async () => {
    await vscode.commands.executeCommand('emojiForClaudeCode.enable')
    await waitFor(() => patcher.status(claudeDir).patched, 'patch applied')
    assert.ok(fs.existsSync(bundle(claudeDir) + '.claude-better-chat.orig'), 'backup missing')
  }],

  ['this Claude Code build still has the message box we look for', async () => {
    // Fails first when Anthropic reworks the chat input: the signal to re-check the DOM selector.
    assert.ok(patcher.status(claudeDir).messageBoxFound, 'aria-label="Message input" not found in the bundle')
  }],

  ['Disable restores the original bundle byte for byte', async () => {
    await vscode.commands.executeCommand('emojiForClaudeCode.disable')
    await waitFor(() => !patcher.status(claudeDir).patched, 'patch removed')
    const original = fs.readFileSync(bundle(claudeDir) + '.claude-better-chat.orig')
    assert.ok(fs.readFileSync(bundle(claudeDir)).equals(original))
  }],

  ['Enable applies it again', async () => {
    await vscode.commands.executeCommand('emojiForClaudeCode.enable')
    await waitFor(() => patcher.status(claudeDir).patched, 'patch re-applied')
  }],

  ['the convertEmoticons setting reaches the injected script', async () => {
    const config = () => vscode.workspace.getConfiguration('emojiForClaudeCode')
    const has = (text) => () => fs.readFileSync(bundle(claudeDir), 'utf8').includes(text)
    await config().update('convertEmoticons', false, vscode.ConfigurationTarget.Global)
    await waitFor(has('{"emoticons":false}'), 'emoticons turned off in the script')
    await config().update('convertEmoticons', undefined, vscode.ConfigurationTarget.Global)
    await waitFor(has('{"emoticons":true}'), 'emoticons back on in the script')
  }],

  ['a Claude Code update unpacked next to the running one gets patched too', async () => {
    // Minimal stand-in for a freshly unpacked new version. Created here, removed below by this exact path.
    const update = path.join(path.dirname(claudeDir), 'anthropic.claude-code-999.0.0-test')
    fs.mkdirSync(path.join(update, 'webview'), { recursive: true })
    try {
      fs.copyFileSync(path.join(claudeDir, 'package.json'), path.join(update, 'package.json'))
      fs.copyFileSync(bundle(claudeDir) + '.claude-better-chat.orig', bundle(update))
      assert.ok(!patcher.status(update).patched)
      await vscode.commands.executeCommand('emojiForClaudeCode.enable')
      await waitFor(() => patcher.status(update).patched, 'sibling version patched')
    } finally {
      fs.rmSync(update, { recursive: true, force: true })
    }
  }],

  ['Show Status runs', async () => {
    await vscode.commands.executeCommand('emojiForClaudeCode.status')
  }],

  ['patched bundle still parses as JavaScript', async () => {
    // new Function() can't take ES module syntax, so check the parts we add instead
    const source = fs.readFileSync(bundle(claudeDir), 'utf8')
    const block = source.slice(source.indexOf(patcher.BEGIN), source.indexOf(patcher.END))
    assert.doesNotThrow(() => new Function(block))
  }],
]

exports.run = async function run() {
  let failed = 0
  for (const [name, fn] of tests) {
    try {
      await fn()
      console.log(`  ✔ ${name}`)
    } catch (error) {
      failed++
      console.log(`  ✖ ${name}\n    ${error.message}`)
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`)
  if (failed) throw new Error(`${failed} test(s) failed`)
}
