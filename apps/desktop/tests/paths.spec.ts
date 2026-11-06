import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { desktopProfileKey, resolveEnterpriseDesktopPaths } from '../src/paths.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('uses different profiles for different users on one server', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-paths-'))
  roots.push(root)
  const first = resolveEnterpriseDesktopPaths({ cloudBaseUrl: 'https://cloud.example.com', userId: 'user-a' }, root)
  const second = resolveEnterpriseDesktopPaths({ cloudBaseUrl: 'https://cloud.example.com', userId: 'user-b' }, root)
  expect(first.profile).not.toBe(second.profile)
  expect(first.lock).toBe(join(first.profile, 'lock'))
})

it('treats trailing slashes and default ports as one server origin', () => {
  expect(desktopProfileKey({ cloudBaseUrl: 'https://cloud.example.com/', userId: 'user-a' }))
    .toBe(desktopProfileKey({ cloudBaseUrl: 'https://cloud.example.com:443', userId: 'user-a' }))
})

it('never places credentials or email in a path', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-paths-'))
  roots.push(root)
  const paths = resolveEnterpriseDesktopPaths({ cloudBaseUrl: 'https://cloud.example.com', userId: 'user-a' }, root)
  expect(paths.profile).toMatch(/\/profiles\/enterprise\/[a-f0-9]{64}$/u)
  expect(paths.profile).not.toContain('user-a')
  expect(paths.profile).not.toContain('@')
})
