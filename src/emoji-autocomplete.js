// Slack-style :shortcode: emoji for the Claude Code chat input.
//
// Appended to the Claude Code extension's webview/index.js by lib/patcher.js.
// It never touches Claude Code's own code: it finds the message box in the DOM
// ([contenteditable][role="textbox"]) and edits text through execCommand, so the
// app sees ordinary typing. If the DOM changes upstream it simply finds nothing.
// Every entry point is wrapped so an error here can never break the chat.
;(() => {
  if (window.__emojiForClaudeCode) return
  window.__emojiForClaudeCode = true

  // Both replaced by lib/patcher.js: src/emoji-data.json and the user's settings.
  const SOURCE = /*EMOJI_DATA*/ {}
  const OPTIONS = /*OPTIONS*/ {}
  const DATA = SOURCE.emoji || [] // [[emoji, [shortcode, ...]], ...]
  const EMOTICONS = OPTIONS.emoticons === false ? {} : SOURCE.emoticons || {} // { ':)': '🙂', ... }
  const MAX_RESULTS = 8
  const MIN_QUERY = 2
  // ":" must start the text or follow whitespace, an opening bracket or a quote. It may also follow
  // another emoji (so :smile::smile: works) or markdown emphasis (* ~) that itself starts a word
  // (so **:warning:** works). That keeps "10:30", "http://", "a:b", "f(x):str" and regex text like
  // ".*:id" from triggering. Emoji may end in a skin tone, U+FE0F, a keycap or a flag tag.
  const START = String.raw`^|[\s([{"']`
  const EMOJI_END = String.raw`[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u20E3\u{E007F}]`
  const PREFIX = `(?:${START}|${EMOJI_END}|(?:${START})[*~]+)`
  // A query may not start with "-" or "_", so emoticons like :-D and :-P stay text. :-1 is the exception.
  const QUERY_RE = new RegExp(`${PREFIX}(:((?:[a-z0-9+]|-1(?![a-z0-9_+-]))[a-z0-9_+-]*))$`, 'iu')
  const FULL_RE = new RegExp(`${PREFIX}(:([a-z0-9_+-]+):)$`, 'iu')
  // An emoticon standing on its own, right after the space that was just typed. Longest first, so >:( beats :(
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const EMOTICON_LIST = Object.keys(EMOTICONS).sort((a, b) => b.length - a.length)
  const EMOTICON_RE = EMOTICON_LIST.length ? new RegExp(`(?:^|\\s)(${EMOTICON_LIST.map(escape).join('|')}) $`) : null

  // Ranked ahead of other matches of the same kind, like Slack's frequently used.
  const POPULAR = new Set(
    '👍 👎 😂 🤣 😅 😊 😉 😍 🥲 🙂 🙃 😐 😬 🤔 🤯 😱 😭 😢 😡 🙏 👏 🙌 💪 👀 🔥 🚀 🎉 ✅ ❌ ⚠️ ❤️ 💯 ✨ 💡 🐛 📌 👋 🤝 🫡 🤷 🤦 😎 🥳 ☕ 🍕 🙈 💀 🫠 👌 ✋ 🆗 ⏳ 📝 🔧'.split(' '),
  )
  // Legacy name from the project's former name. Keep it so users' history survives updates.
  const RECENT_KEY = 'claude-better-chat.emoji.recent'
  const recent = (() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY)) || {}
    } catch {
      return {}
    }
  })()
  const remember = (emoji) => {
    recent[emoji] = (recent[emoji] || 0) + 1
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
    } catch {}
  }

  const byName = new Map()
  for (const [emoji, names] of DATA) for (const n of names) if (!byName.has(n)) byName.set(n, emoji)

  const safe =
    (fn) =>
    (...args) => {
      try {
        return fn(...args)
      } catch (err) {
        console.warn('[emoji-for-claude-code]', err)
      }
    }

  const isMessageBox = (el) =>
    !!el && el.isContentEditable && el.getAttribute('role') === 'textbox'

  // Text node + offset of a collapsed caret inside a message box, or null.
  function caret() {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null
    const node = sel.anchorNode
    if (!node || node.nodeType !== Node.TEXT_NODE) return null
    const box = node.parentElement && node.parentElement.closest('[contenteditable]')
    if (!isMessageBox(box)) return null
    return { node, offset: sel.anchorOffset, box }
  }

  // Best matches for q. Each result is labeled with the shortcode that matched, so the list
  // always shows something that contains what was typed.
  function search(q) {
    q = q.toLowerCase()
    const scored = []
    for (const [emoji, names] of DATA) {
      let best = Infinity
      let label = names[0]
      for (let i = 0; i < names.length; i++) {
        const n = names[i]
        let s
        if (n === q) s = 0
        else if (n.startsWith(q)) s = 1 + n.length / 100
        else if (n.includes('_' + q) || n.includes('-' + q)) s = 2 + n.length / 100
        else if (n.includes(q)) s = 3 + n.length / 100
        else continue
        s += i / 1000
        if (s < best) {
          best = s
          label = n
        }
      }
      if (best === Infinity) continue
      // boosts stay below 1, so a better kind of match (exact, prefix, word start) always wins
      if (best >= 1) best -= Math.min(0.9, (POPULAR.has(emoji) ? 0.1 : 0) + (recent[emoji] || 0) * 0.1)
      scored.push([best, emoji, label])
    }
    scored.sort((a, b) => a[0] - b[0])
    return scored.slice(0, MAX_RESULTS).map(([, emoji, name]) => ({ emoji, name }))
  }

  // Replace node.data[start, end) with text the way the user would type it.
  let lastReplaced = null
  function replace(node, start, end, text) {
    lastReplaced = node.data.slice(start, end)
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    document.execCommand('insertText', false, text)
  }

  // ---- popup -------------------------------------------------------------
  const style = document.createElement('style')
  style.textContent = `
    .efcc-emoji{position:fixed;z-index:2147483647;min-width:220px;max-width:340px;padding:4px;
      border-radius:6px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);
      background:var(--vscode-editorSuggestWidget-background,var(--vscode-editorWidget-background,#252526));
      color:var(--vscode-editorSuggestWidget-foreground,var(--vscode-foreground,#ccc));
      border:1px solid var(--vscode-editorSuggestWidget-border,var(--vscode-widget-border,#454545));
      box-shadow:0 4px 16px var(--vscode-widget-shadow,rgba(0,0,0,.36));box-sizing:border-box;overflow-y:auto}
    .efcc-emoji[hidden]{display:none}
    .efcc-emoji-item{display:flex;gap:8px;align-items:center;padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap}
    .efcc-emoji-item span:first-child{font-size:1.25em;width:1.4em;text-align:center}
    .efcc-emoji-item span:last-child{overflow:hidden;text-overflow:ellipsis;opacity:.9}
    .efcc-emoji-item[aria-selected=true]{
      background:var(--vscode-editorSuggestWidget-selectedBackground,var(--vscode-list-activeSelectionBackground,#04395e));
      color:var(--vscode-editorSuggestWidget-selectedForeground,var(--vscode-list-activeSelectionForeground,#fff))}`
  const popup = document.createElement('div')
  popup.className = 'efcc-emoji'
  popup.setAttribute('role', 'listbox')
  popup.hidden = true

  let state = null // { node, start, end, items, index }
  let dismissed = null // query string the user closed with Escape

  function close() {
    state = null
    popup.hidden = true
  }

  function render() {
    const scroll = popup.scrollTop
    popup.replaceChildren(
      ...state.items.map((it, i) => {
        const row = document.createElement('div')
        row.className = 'efcc-emoji-item'
        row.setAttribute('role', 'option')
        row.setAttribute('aria-selected', String(i === state.index))
        const e = document.createElement('span')
        e.textContent = it.emoji
        const n = document.createElement('span')
        n.textContent = `:${it.name}:`
        row.append(e, n)
        // mousedown + preventDefault keeps focus and caret in the message box
        row.addEventListener('mousedown', safe((ev) => {
          ev.preventDefault()
          if (ev.button !== 0) return
          state.index = i
          accept()
        }))
        return row
      }),
    )
    popup.hidden = false
    // in a panel shorter than the list, the list scrolls and keeps the selected row visible
    popup.style.maxHeight = `${Math.max(60, window.innerHeight - 8)}px`
    popup.scrollTop = scroll
    popup.children[state.index]?.scrollIntoView({ block: 'nearest' })
    const range = document.createRange()
    range.setStart(state.node, state.start)
    range.setEnd(state.node, state.end)
    const r = range.getBoundingClientRect()
    const h = popup.offsetHeight
    const w = popup.offsetWidth
    // The input sits at the bottom of the panel, so prefer opening upwards. Clamp to the viewport;
    // in a very short panel the list covers the caret line rather than going off-screen.
    const top = r.top - h - 4 >= 0 ? r.top - h - 4 : r.bottom + 4
    popup.style.top = `${Math.max(4, Math.min(top, window.innerHeight - h - 4))}px`
    popup.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`
  }

  function accept() {
    if (!state) return
    const { node, start, end, items, index } = state
    close()
    replace(node, start, end, items[index].emoji)
    remember(items[index].emoji)
  }

  const onInput = safe((ev) => {
    if (ev.isComposing) return
    // Cmd+Z after a conversion brings the typed text back, and converting it again would make undo useless.
    // The browser restores that text selected, so drop the selection or the next keystroke would delete it.
    if (ev.inputType === 'historyUndo' || ev.inputType === 'historyRedo') {
      const sel = window.getSelection()
      if (ev.inputType === 'historyUndo' && lastReplaced !== null && sel.rangeCount && !sel.isCollapsed && sel.toString() === lastReplaced) {
        sel.collapseToEnd()
      }
      return close()
    }
    const c = caret()
    if (!c) {
      dismissed = null
      return close()
    }
    const before = c.node.data.slice(0, c.offset)

    if (EMOTICON_RE && ev.inputType === 'insertText' && ev.data === ' ') {
      const e = EMOTICON_RE.exec(before)
      if (e) {
        close()
        // the emoticon and the space together, so the caret ends up after the space
        replace(c.node, c.offset - e[1].length - 1, c.offset, `${EMOTICONS[e[1]]} `)
        remember(EMOTICONS[e[1]])
        return
      }
    }

    const full = FULL_RE.exec(before)
    if (full && byName.has(full[2].toLowerCase())) {
      const emoji = byName.get(full[2].toLowerCase())
      close()
      replace(c.node, c.offset - full[1].length, c.offset, emoji)
      remember(emoji)
      return
    }

    const m = QUERY_RE.exec(before)
    if (!m || m[2].length < MIN_QUERY) {
      dismissed = null
      return close()
    }
    if (m[2] === dismissed) return close()
    dismissed = null
    const items = search(m[2])
    if (!items.length) return close()
    state = { node: c.node, start: c.offset - m[1].length, end: c.offset, items, index: 0 }
    render()
  })

  const onKeyDown = safe((ev) => {
    if (!state || ev.isComposing || !isMessageBox(ev.target)) return
    const n = state.items.length
    let handled = true
    switch (ev.key) {
      case 'ArrowDown':
        state.index = (state.index + 1) % n
        render()
        break
      case 'ArrowUp':
        state.index = (state.index - 1 + n) % n
        render()
        break
      case 'Enter':
      case 'Tab':
        if (ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) handled = false
        else accept()
        break
      case 'Escape': {
        const c = caret()
        const m = c && QUERY_RE.exec(c.node.data.slice(0, c.offset))
        dismissed = m ? m[2] : null
        close()
        break
      }
      default:
        handled = false
    }
    if (handled) {
      // capture phase on window runs before React's root listener, so Enter
      // never submits and Escape never interrupts Claude while the popup is open
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }
  })

  const onSelectionChange = safe(() => {
    if (!state) return
    const c = caret()
    if (!c || c.node !== state.node || c.offset !== state.end) close()
  })

  // Clicking a row doesn't move focus (see mousedown above), so this only fires when focus really leaves.
  const onFocusOut = safe((ev) => {
    if (isMessageBox(ev.target)) close()
  })

  safe(() => {
    document.head.appendChild(style)
    document.body.appendChild(popup)
    window.addEventListener('input', onInput, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
  })()
})()
