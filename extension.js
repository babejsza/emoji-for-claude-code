// VS Code entry point: keeps the Claude Code chat patched (see lib/patcher.js).
'use strict'

const path = require('path')
const vscode = require('vscode')
const patcher = require('./lib/patcher')

const NAME = 'Emoji for Claude Code'
const CLAUDE_ID = 'anthropic.claude-code'
const SECTION = 'emojiForClaudeCode'
const CONSENT_KEY = 'consentedToPatch'
const DECLINED_KEY = 'declinedToPatch'

let globalState
let askedThisSession = false
let prompting = false
let verboseNext = false
const reported = new Set()

function claudeDir() {
  const ext = vscode.extensions.getExtension(CLAUDE_ID)
  return ext && patcher.isClaudeCodeExtension(ext.extensionPath) ? ext.extensionPath : null
}

function missingMessage() {
  return vscode.extensions.getExtension(CLAUDE_ID)
    ? `${NAME}: this Claude Code version has a file layout that is not supported yet (webview/index.js not found).`
    : `${NAME}: Claude Code is not installed.`
}

const enabled = () => vscode.workspace.getConfiguration(SECTION).get('enabled', true)
const options = () => ({ emoticons: vscode.workspace.getConfiguration(SECTION).get('convertEmoticons', true) })

// Not awaited, so an unanswered notification never holds up the next sync.
function offerReload(message) {
  vscode.window.showInformationMessage(message, 'Reload Window').then((choice) => {
    if (choice) vscode.commands.executeCommand('workbench.action.reloadWindow')
  })
}

// Each distinct problem is shown once per session, not on every extension change. Explicit actions
// (commands, settings) clear the list first, so they always get an answer.
function report(error, action = 'change') {
  if (reported.has(error.message)) return
  reported.add(error.message)
  vscode.window.showWarningMessage(`${NAME} could not ${action} Claude Code's files (${error.message}).`)
}

// Nothing is written to Claude Code until the user agrees once, in this question or via the Enable
// command. "Not now" is remembered, so it is not asked again at startup, but switching the setting
// off and on asks again. The question is not awaited, so it never holds up other syncs. "Apply" starts one.
function hasConsent({ explicit }) {
  if (globalState.get(CONSENT_KEY)) return true
  if (prompting || askedThisSession || (globalState.get(DECLINED_KEY) && !explicit)) return false
  askedThisSession = true
  prompting = true
  vscode.window
    .showInformationMessage(
      `${NAME} adds :emoji: to the Claude Code chat by appending a small script to the Claude Code extension's ` +
        'webview/index.js (a backup copy is kept next to it). The "Emoji for Claude Code: Disable" command, ' +
        'or uninstalling this extension, removes it again. Apply it now?',
      'Apply',
      'Not now',
    )
    .then(async (choice) => {
      prompting = false
      if (choice === 'Not now') await globalState.update(DECLINED_KEY, true)
      if (choice !== 'Apply') return
      await globalState.update(CONSENT_KEY, true)
      await globalState.update(DECLINED_KEY, undefined)
      sync({ applied: true })
    })
  return false
}

function applyOrRemove(dir, on) {
  try {
    return on ? patcher.apply(dir, options()) : patcher.remove(dir)
  } catch (error) {
    report(error)
    return null
  }
}

// Brings the installed Claude Code in line with the setting. Quiet when nothing changes.
async function doSync({ verbose = false, explicit = false, applied = false } = {}) {
  const dir = claudeDir()
  if (!dir) {
    if (verbose) vscode.window.showInformationMessage(missingMessage())
    return
  }
  const on = enabled()
  if (on && !hasConsent({ explicit })) return
  // A Claude Code update unpacks next to the running version. Patch it right away so the
  // reload that activates it already includes the emoji. Old versions VS Code is about to
  // delete may vanish meanwhile, so a sibling never stops the running version from being handled.
  for (const other of patcher.findExtensions([path.dirname(dir)])) {
    if (other !== dir && patcher.isClaudeCodeExtension(other)) applyOrRemove(other, on)
  }
  const result = applyOrRemove(dir, on)
  if (result === 'patched') offerReload(`${NAME} is ready. Reload the window to use :emoji: in the Claude Code chat.`)
  else if (result === 'updated') offerReload(`${NAME} was updated. Reload the window to apply it.`)
  else if (result === 'removed') offerReload(`${NAME} was turned off. Reload the window to apply it.`)
  // another window may have applied it first, and this window still needs a reload to see it
  else if (applied && result === 'up-to-date') offerReload(`${NAME} is applied. Reload the window to use :emoji: in the Claude Code chat.`)
  else if (verbose && result === 'up-to-date') vscode.window.showInformationMessage(`${NAME} is on.`)
  else if (verbose && result === 'not-patched') vscode.window.showInformationMessage(`${NAME} is off.`)
}

// Runs one sync at a time, so activation, extension changes and commands never interleave.
let queue = Promise.resolve()
function sync(options) {
  queue = queue.then(() => doSync(options)).catch((error) => report(error))
  return queue
}

async function setEnabled(value) {
  reported.clear()
  if (value) {
    // running Enable is an explicit yes
    await globalState.update(CONSENT_KEY, true)
    await globalState.update(DECLINED_KEY, undefined)
  }
  const config = vscode.workspace.getConfiguration(SECTION)
  if (config.get('enabled', true) === value) return sync({ verbose: true })
  // the configuration change below triggers the sync
  verboseNext = true
  try {
    await config.update('enabled', value, vscode.ConfigurationTarget.Global)
  } catch (error) {
    verboseNext = false
    throw error
  }
}

function activate(context) {
  globalState = context.globalState
  context.subscriptions.push(
    // Claude Code updates install an unpatched copy, so re-apply when that happens.
    vscode.extensions.onDidChange(() => sync()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SECTION)) return
      reported.clear()
      // convertEmoticons changes the injected script, so it is re-applied (and a reload offered)
      if (e.affectsConfiguration(`${SECTION}.convertEmoticons`) && !e.affectsConfiguration(`${SECTION}.enabled`)) {
        return sync()
      }
      if (!e.affectsConfiguration(`${SECTION}.enabled`)) return
      // turning the setting on by hand counts as asking for it, so the question may be asked again
      const verbose = verboseNext
      verboseNext = false
      askedThisSession = false
      sync({ verbose, explicit: true })
    }),
    vscode.commands.registerCommand(`${SECTION}.enable`, () => setEnabled(true)),
    vscode.commands.registerCommand(`${SECTION}.disable`, () => setEnabled(false)),
    vscode.commands.registerCommand(`${SECTION}.status`, () => {
      reported.clear()
      const dir = claudeDir()
      if (!dir) return vscode.window.showInformationMessage(missingMessage())
      const where = `Claude Code ${vscode.extensions.getExtension(CLAUDE_ID).packageJSON.version}`
      let s
      try {
        s = patcher.status(dir)
      } catch (error) {
        return report(error, 'read')
      }
      vscode.window.showInformationMessage(
        s.patched
          ? `${NAME}${s.version ? ` v${s.version}` : ''} is applied to ${where}.` +
              (s.messageBoxFound ? '' : ' Warning: this Claude Code build looks different, so suggestions may not appear.')
          : `${NAME} is not applied to ${where}.`,
      )
    }),
  )
  sync()
}

function deactivate() {}

module.exports = { activate, deactivate }
