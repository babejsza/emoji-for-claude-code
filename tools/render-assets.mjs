#!/usr/bin/env node
// Renders images/icon.png, images/publisher-logo-128.png (Marketplace publisher profile),
// images/screenshot-*.png and images/demo.gif in headless Chrome, using the real chat script.
// The chat panel around it is a neutral stand-in, not Claude Code's actual UI.
// Needs Google Chrome (or CHROME=<path>), Node 22+ and ffmpeg for the GIF.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import patcher from '../lib/patcher.js'
import { launchChrome } from './cdp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'images')
mkdirSync(OUT, { recursive: true })
const code = patcher.inlineScript()

const ICON = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:transparent}</style>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6C344"/><stop offset="1" stop-color="#E8912D"/></linearGradient></defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="#1F1F1F"/>
  <path d="M60 64h136a24 24 0 0 1 24 24v76a24 24 0 0 1-24 24h-82l-38 30v-30h-16a24 24 0 0 1-24-24V88a24 24 0 0 1 24-24z" fill="#2D2D30" stroke="#3E3E42" stroke-width="4"/>
  <circle cx="128" cy="126" r="46" fill="url(#g)"/>
  <circle cx="112" cy="114" r="6.5" fill="#3B2A10"/><circle cx="144" cy="114" r="6.5" fill="#3B2A10"/>
  <path d="M106 136q22 22 44 0" fill="none" stroke="#3B2A10" stroke-width="7" stroke-linecap="round"/>
  <g fill="#CCCCCC"><circle cx="52" cy="112" r="7"/><circle cx="52" cy="140" r="7"/><circle cx="204" cy="112" r="7"/><circle cx="204" cy="140" r="7"/></g>
</svg>`

// Modeled on the Claude Code chat panel (layout and colors only, no logos), so the screenshots show
// roughly what users will see. The suggestion list itself is the real script.
const PANEL = `<!doctype html><meta charset=utf-8><style>
  :root{--vscode-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--vscode-font-size:13px}
  html,body{margin:0;height:100%;background:#1b1b1c;color:#d4d4d4;font:13px/1.5 var(--vscode-font-family)}
  .panel{position:absolute;inset:0;display:flex;flex-direction:column}
  .msgs{flex:1;padding:20px 18px;display:flex;flex-direction:column;gap:14px;overflow:hidden}
  .me{align-self:flex-start;max-width:85%;background:#262628;border:1px solid #333336;border-radius:8px;padding:7px 11px;color:#e6e6e6}
  .ai{display:flex;gap:9px;max-width:95%;color:#d4d4d4}
  .ai:before{content:"";flex:none;width:7px;height:7px;margin-top:7px;border-radius:50%;background:#7c7c80}
  .ai code{background:#2b2b2e;padding:1px 5px;border-radius:4px;font-family:Menlo,monospace;font-size:12px}
  .input{margin:0 16px 16px;border:1px solid #3a3a3e;border-radius:12px;background:#1e1e1f}
  .top{display:flex;align-items:flex-start;gap:8px;padding:11px 12px 10px 14px}
  #box{flex:1;min-height:21px;outline:none;font-size:14px;white-space:pre-wrap;color:#e8e8e8}
  #box:empty:before{content:"\\2318 Esc to focus or unfocus Claude";color:#6f6f73}
  .bar{display:flex;align-items:center;gap:12px;padding:8px 10px 9px 12px;border-top:1px solid #2e2e31;color:#bdbdc1}
  .pill{background:#2a2a2d;border-radius:7px;padding:3px 9px;font-size:13px;color:#d4d4d8}
  .pill span{color:#8d8d92;margin-left:4px}
  .grow{flex:1}
  .send{width:30px;height:30px;border-radius:7px;background:#8f4e40;display:grid;place-items:center}
  svg{display:block}
</style><div class=panel><div class=msgs>
  <div class=me>Can you add retry logic to the upload service?</div>
  <div class=ai><div>Done. <code>uploadFile()</code> now retries 3 times with exponential backoff, and the tests in <code>upload.test.ts</code> pass.</div></div>
</div><div class=input>
  <div class=top><div id=box contenteditable="plaintext-only" role="textbox" aria-label="Message input"></div>
    <svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="#8d8d92" stroke-width="1.4" stroke-linecap="round"><rect x="5" y="1" width="6" height="10" rx="3"/><path d="M2 8a6 6 0 0 0 12 0M8 14v3"/></svg></div>
  <div class=bar>
    <svg width="16" height="16" viewBox="0 0 16 16" stroke="#bdbdc1" stroke-width="1.5" stroke-linecap="round"><path d="M8 2v12M2 8h12"/></svg>
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="#bdbdc1" stroke-width="1.4"><rect x="1.5" y="1.5" width="14" height="14" rx="2.5"/><path d="M10.5 4.5l-4 8" stroke-linecap="round"/></svg>
    <div class=pill>Opus 5.5<span>Medium</span></div>
    <div class=grow></div>
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="#bdbdc1" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1L2 9h4.5L5.5 15 12 7H7.5z"/></svg><span>Auto</span>
    <div class=send><svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="#e9c3b8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14V2M2 7l5-5 5 5"/></svg></div>
  </div>
</div></div>
<script>try{localStorage.clear()}catch{}</script><script>${code}</script>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await launchChrome()
const tmp = browser.dir
const { send } = browser

const shot = async (file, clip, scale = 1) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip && { clip: { ...clip, scale } }) })
  writeFileSync(file, Buffer.from(data, 'base64'))
}
const open = async (page, width, height, scale) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  await send('Page.navigate', { url: `file://${tmp}/${page}` })
  await sleep(700)
}
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
}

try {
  writeFileSync(join(tmp, 'icon.html'), ICON)
  writeFileSync(join(tmp, 'panel.html'), PANEL)

  // icon and publisher logo
  await open('icon.html', 256, 256, 1)
  await shot(join(OUT, 'icon.png'), { x: 0, y: 0, width: 256, height: 256 })
  await shot(join(OUT, 'publisher-logo-128.png'), { x: 0, y: 0, width: 256, height: 256 }, 0.5)

  // screenshots + GIF frames
  const W = 520
  const H = 420
  await open('panel.html', W, H, 2)
  await send('Runtime.evaluate', { expression: 'box.focus()' })
  const frames = join(tmp, 'frames')
  mkdirSync(frames)
  let n = 0
  const frame = async (hold = 1) => {
    for (let i = 0; i < hold; i++) await shot(join(frames, `f${String(n++).padStart(4, '0')}.png`))
  }
  const type = async (s, perChar = 1) => {
    for (const ch of s) {
      await send('Input.insertText', { text: ch })
      await sleep(20)
      await frame(perChar)
    }
  }

  await frame(6)
  await type('Ship it ')
  await type(':roc')
  await frame(10)
  await shot(join(OUT, 'screenshot-suggestions.png'))
  await key('Enter', 'Enter', 13)
  await sleep(50)
  await frame(8)
  await type(' thanks ')
  await type(':tada:')
  await sleep(50)
  await frame(16)
  await shot(join(OUT, 'screenshot-converted.png'))
  await type(' :heart')
  await frame(4)
  await key('ArrowDown', 'ArrowDown', 40)
  await sleep(30)
  await frame(6)
  await shot(join(OUT, 'screenshot-navigate.png'))
  await key('Tab', 'Tab', 9)
  await sleep(50)
  await frame(8)
  await type(' :D ')
  await sleep(50)
  await frame(24)

  // 10 fps GIF with a palette tuned to the frames, at 1x width to stay small
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', '10', '-i', join(frames, 'f%04d.png'),
    '-vf', `scale=${W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    join(OUT, 'demo.gif')])
} finally {
  await browser.close()
}
console.log('wrote images/icon.png, images/publisher-logo-128.png, images/screenshot-*.png, images/demo.gif')
