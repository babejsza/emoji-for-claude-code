// End-to-end check of the chat script in headless Chrome (DevTools Protocol, no npm deps).
// Usage: node test/e2e-chrome.mjs   (needs Google Chrome, or CHROME=<path>, and Node 22+)
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import patcher from '../lib/patcher.js'
import { launchChrome } from '../tools/cdp.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await launchChrome()
let failed = 0
try {
  // Mirrors the real message box (contenteditable="plaintext-only", role=textbox). The app listens for Enter/Escape.
  const page = (options) =>
    `<!doctype html><meta charset=utf-8><body style="padding-top:300px"><div id=box contenteditable="plaintext-only" role="textbox" aria-label="Message input" style="border:1px solid;min-height:40px"></div><button id=other>other</button><script>window.log=[];document.body.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key==="Escape")log.push("app:"+e.key)});box.addEventListener("input",()=>log.push("input"))</script><script>try{localStorage.clear()}catch{}</script><script>${patcher.inlineScript(options)}</script>`
  writeFileSync(join(browser.dir, 'page.html'), page())
  writeFileSync(join(browser.dir, 'page-off.html'), page({ emoticons: false }))
  const { send } = browser
  await send('Page.navigate', { url: `file://${join(browser.dir, 'page.html')}` })
  await sleep(500)
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value
  const type = async (s) => {
    for (const ch of s) {
      await send('Input.insertText', { text: ch })
      await sleep(10)
    }
  }
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
    await sleep(30)
  }
  const text = () => ev('box.textContent')
  const clear = () => ev('box.textContent = ""; box.focus(); true')
  // [emoji, label] of every visible row, or null when the popup is closed
  const popup = () =>
    ev(`(()=>{const p=document.querySelector(".efcc-emoji");return p&&!p.hidden?[...p.children].map(c=>[c.children[0].textContent,c.children[1].textContent]):null})()`)
  const check = (name, ok, got) => {
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`)
  }

  await ev('box.focus()')
  await type(':thinking_face:')
  let t = await text()
  check('full :thinking_face: -> 🤔', t === '🤔', t)
  await type(' :roc')
  let p = await popup()
  check('popup for :roc shows 🚀 first', p?.[0]?.[0] === '🚀', p)
  await key('Enter', 'Enter', 13)
  t = await text()
  let log = await ev('log.join(",")')
  check('Enter inserts 🚀', t === '🤔 🚀', t)
  check('Enter not passed to app', !log.includes('app:Enter'), log)

  for (const s of ['x 10:30', 'x a:bc', 'x f(x):str', 'x http://localhost', 'x:smile', "grep '.*:id", 'a*:bc', ' :-D']) {
    await clear()
    await type(s)
    check(`no popup for ${s}`, (await popup()) === null, await popup())
  }
  await clear()
  await type("grep '.*:id")
  await key('Enter', 'Enter', 13)
  log = await ev('log.join(",")')
  check('Enter after .*:id reaches the app', log.endsWith('app:Enter') && (await text()) === "grep '.*:id", { log, t: await text() })
  await clear()
  await type('x :smile')
  check('popup for x :smile (control)', !!(await popup()), await popup())

  await clear()
  await type(':jo')
  p = await popup()
  const second = p?.[1]?.[0]
  await key('ArrowDown', 'ArrowDown', 40)
  await key('Tab', 'Tab', 9)
  t = await text()
  check('ArrowDown + Tab inserts the second suggestion', !!second && t === second, { t, p })

  await clear()
  await type(':smi')
  p = await popup()
  check(':smi suggests 😄 :smile: first', p?.[0]?.[0] === '😄' && p[0][1] === ':smile:', p)
  await key('Escape', 'Escape', 27)
  log = await ev('log.join(",")')
  check('Escape closes', (await popup()) === null, await popup())
  check('Escape not passed to app', !log.includes('app:Escape'), log)
  await type('l')
  check('reopens after typing more', !!(await popup()), await popup())
  await key('Escape', 'Escape', 27)
  await key('Escape', 'Escape', 27)
  log = await ev('log.join(",")')
  check('Escape reaches the app when the popup is closed', log.includes('app:Escape'), log)

  await clear()
  await type(':smile::smile: **:warning:** :-1: 👍🏽:tada:')
  t = await text()
  check('consecutive shortcodes, markdown emphasis, :-1: and after a skin tone convert', t === '😄😄 **⚠️** 👎 👍🏽🎉', t)

  await clear()
  await type(':train:')
  t = await text()
  check(':train: gives the same emoji as Slack (🚋)', t === '🚋', t)

  await clear()
  await type(':roc')
  await ev('document.getElementById("other").focus()')
  await sleep(50)
  check('popup closes when focus leaves the message box', (await popup()) === null, await popup())

  await clear()
  await type(':P :D ;) <3 ')
  t = await text()
  check('emoticons convert after a space', t === '😛 😄 😉 ❤️ ', t)

  await clear()
  await type('C: 8) :/ x:P :D')
  t = await text()
  check('drive letters, numbering, paths, glued and unfinished emoticons stay text', t === 'C: 8) :/ x:P :D', t)

  await clear()
  await type(':rocket:')
  await ev('document.execCommand("undo")')
  t = await text()
  check('undo after a conversion brings the typed text back for good', t === ':rocket:', t)
  await type(' go')
  t = await text()
  check('typing after undo keeps the restored text', t === ':rocket: go', t)

  await clear()
  await type('hi :P ')
  await ev('document.execCommand("undo")')
  await type('x')
  t = await text()
  check('undo after an emoticon conversion, then typing, keeps :P', t === 'hi :P x', t)

  log = await ev('log.join(",")')
  check('input events reach the app', log.includes('input'), log)

  await send('Page.navigate', { url: `file://${join(browser.dir, 'page-off.html')}` })
  await sleep(500)
  await ev('box.focus()')
  await type(':P :smile: ')
  t = await text()
  check('with convertEmoticons off, :P stays text but shortcodes still convert', t === ':P 😄 ', t)
} finally {
  await browser.close()
}
process.exitCode = failed ? 1 : 0
