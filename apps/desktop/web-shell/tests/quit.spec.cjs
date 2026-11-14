const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const main = readFileSync(path.join(__dirname, '../main.cjs'), 'utf8')

test('asks before closing the main window', () => {
  assert.match(main, /mainWindow\.on\('close', \(event\) => \{/)
  assert.match(main, /event\.preventDefault\(\)/)
  assert.match(main, /确定要退出织流吗？/)
  assert.match(main, /buttons: \['取消', '退出'\]/)
  assert.match(main, /defaultId: 0/)
  assert.match(main, /cancelId: 0/)
})

test('programmatic quits and update restarts skip the close prompt', () => {
  assert.match(main, /app\.on\('before-quit', \(\) => \{ allowQuit = true \}\)/)
  assert.match(main, /allowQuit = true\n\s+mainWindow\.close\(\)/)
})
