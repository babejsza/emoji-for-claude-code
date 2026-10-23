#!/usr/bin/env node
// Integration tests in a real, isolated VS Code (@vscode/test-electron).
// Downloads VS Code stable into .vscode-test/, installs the real Claude Code extension
// into a fresh temporary extensions dir, then runs test/vscode/suite.cjs inside it.
// Your own VS Code profile and extensions are never touched.
//
//   npm run test:vscode
//   CLAUDE_CODE=<path to .vsix or extension id>  test a specific Claude Code build
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron'

// Set when this runs from a VS Code terminal or agent. It would start the test VS Code as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = mkdtempSync(join(tmpdir(), 'efcc-vscode-'))
const profile = [`--extensions-dir=${join(sandbox, 'extensions')}`, `--user-data-dir=${join(sandbox, 'user-data')}`]

try {
  const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: process.env.VSCODE_VERSION || 'stable', cachePath: join(ROOT, '.vscode-test') })
  const cli = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath)
  const claude = process.env.CLAUDE_CODE || 'anthropic.claude-code'
  const install = spawnSync(cli, [...profile, '--install-extension', claude], { stdio: 'inherit' })
  if (install.status !== 0) throw new Error(`could not install ${claude}`)

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: ROOT,
    extensionTestsPath: join(ROOT, 'test', 'vscode', 'suite.cjs'),
    launchArgs: [...profile, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-telemetry'],
  })
} catch (error) {
  console.error(error.message || error)
  process.exitCode = 1
} finally {
  // sandbox is the one directory this script created above
  rmSync(sandbox, { recursive: true, force: true })
}
