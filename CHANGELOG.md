# Changelog

## 1.0.0

- Slack-style `:shortcode:` emoji in the Claude Code chat. `:tada:` becomes 🎉 as soon as you type the closing colon.
- A list of matching emoji opens after `:` and two letters. Use the arrow keys, `Enter` or `Tab`, `Esc`, or the mouse.
- Slack's shortcodes plus official Unicode names, 1,914 emoji up to Unicode 17 (data from iamcal/emoji-data).
- Popular emoji and the ones you pick most often move up in the list. The history stays on your computer.
- Common emoticons such as `:)`, `:D`, `:P`, `;)` and `<3` turn into emoji after a space. Things that look like code
  or paths, such as `C:`, `8)` and `:/`, are left alone, and undo brings back what you typed.
- Works right after another emoji and inside markdown emphasis, and ignores times and things like `a:b`.
- Asks before changing anything, keeps working after Claude Code updates and cleans up when uninstalled.
- Enable, Disable and Show Status commands, plus the `emojiForClaudeCode.enabled` and
  `emojiForClaudeCode.convertEmoticons` settings.
