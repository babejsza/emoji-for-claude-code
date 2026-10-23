// Runs via "vscode:uninstall" after this extension is fully removed (no VS Code API here).
// Removes the patch from Claude Code installs that live next to this extension.
'use strict'

const path = require('path')
const patcher = require('./lib/patcher')

const extensionsRoot = path.dirname(__dirname)
for (const dir of patcher.findExtensions([extensionsRoot])) {
  try {
    patcher.remove(dir)
  } catch (error) {
    console.error(`[emoji-for-claude-code] ${dir}: ${error.message}`)
  }
}
