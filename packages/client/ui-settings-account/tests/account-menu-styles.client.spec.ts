/** Account-owned sidebar spacing and total control heights. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/AccountMenu.module.css', import.meta.url), 'utf8')

it('insets only the account root without resizing the settings carrier', () => {
  expect(css).toMatch(/\.root\[data-inset='true'\]\s*\{\s*margin-inline: 2px;\s*\}/)
  expect(css).toMatch(/\.root\s*\{[^}]*flex: 1;[^}]*min-width: 0;/)
})

it('includes padding and borders in the 44px account and More rows', () => {
  const trigger = css.match(/\.trigger\s*\{([^}]+)\}/)?.[1]
  expect(trigger).toContain('box-sizing: border-box;')
  expect(trigger).toContain('height: 44px;')
  expect(css).toMatch(/\.trigger\[data-signed-out='true'\]:not\(\[data-collapsed='true'\]\)\s*\{[^}]*height: 44px;/)
  expect(css).toMatch(/\.trigger\[data-collapsed='true'\]\s*\{[^}]*width: 36px;[^}]*height: 36px;/)
})

it('presents sign-in as the signed-out menu primary action', () => {
  expect(css).toMatch(/\.signedOutMenu\[role='menu'\]\s*\{[^}]*min-width: 208px;/)
  expect(css).toMatch(
    /\.signedOutMenu > \[data-menu-footer\] \[role='menuitem'\]\s*\{[^}]*background: var\(--dsw-alias-button-primary-fill\);/,
  )
  expect(css).toMatch(
    /\.signedOutMenu > \[data-menu-footer\] \[role='menuitem'\]\s*\{[^}]*color: var\(--dsw-alias-label-primary-foreground\);/,
  )
})
