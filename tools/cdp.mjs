// Minimal headless Chrome driver over the DevTools Protocol, shared by test/e2e-chrome.mjs and
// tools/render-assets.mjs. No npm dependencies. Needs Node 22+ (global WebSocket) and Chrome.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULTS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isFile = (p) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

// Starts Chrome on a free port in a fresh temp dir. close() stops it and removes exactly that dir.
export async function launchChrome() {
  const binary = process.env.CHROME || DEFAULTS.find(isFile)
  if (!binary || !isFile(binary)) {
    throw new Error(`Google Chrome not found${binary ? ` at ${binary}` : ''}. Set CHROME=<path to the Chrome binary>.`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'efcc-chrome-'))
  const profile = join(dir, 'profile')
  const chrome = spawn(binary, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
  // 'close' also fires when the binary could not be started at all, 'exit' does not
  const exited = new Promise((r) => chrome.once('close', r))
  const failed = new Promise((_, reject) => {
    chrome.once('error', reject)
    chrome.once('close', () => reject(new Error('Chrome exited')))
  })
  failed.catch(() => {})

  // Wait for Chrome to exit before deleting, or it keeps writing into the profile.
  const close = async () => {
    chrome.kill()
    let timer
    const timeout = new Promise((r) => (timer = setTimeout(r, 5000, 'timeout')))
    if ((await Promise.race([exited, timeout])) === 'timeout') {
      chrome.kill('SIGKILL')
      await exited
    }
    clearTimeout(timer)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }

  try {
    // Chrome writes the port it picked to DevToolsActivePort in the profile
    let port
    for (let i = 0; i < 100 && !port; i++) {
      try {
        port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
      } catch {}
      if (!port) await Promise.race([sleep(100), failed])
    }
    if (!port) throw new Error('Chrome did not start')
    let page
    for (let i = 0; i < 50 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
      } catch {}
      if (!page) await Promise.race([sleep(100), failed])
    }
    if (!page) throw new Error('no Chrome page target')

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    let id = 0
    const pending = new Map()
    const rejectAll = (error) => {
      for (const p of pending.values()) p.reject(error)
      pending.clear()
    }
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      const p = pending.get(d.id)
      if (!p) return
      pending.delete(d.id)
      if (d.error) p.reject(new Error(`${p.method}: ${d.error.message}`))
      else p.resolve(d.result)
    }
    ws.onclose = ws.onerror = () => rejectAll(new Error('Chrome connection closed'))
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) return reject(new Error('Chrome connection closed'))
        pending.set(++id, { method, resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    return {
      dir,
      send,
      close: () => {
        ws.onclose = ws.onerror = null
        ws.close()
        return close()
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
