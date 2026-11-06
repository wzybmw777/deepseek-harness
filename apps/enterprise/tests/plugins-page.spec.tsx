// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../src/components/Toast.tsx'
import { PluginsPage } from '../src/pages/PluginsPage.tsx'
import type { PluginsView } from '../src/lib/types.ts'

const auth = vi.hoisted(() => ({
  roleId: 'role-owner',
  permissions: ['plugins.builtin.write', 'plugins.enterprise.write'] as string[],
}))

const api = vi.hoisted(() => ({
  plugins: vi.fn(),
  addBuiltinPlugin: vi.fn(),
  addPlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
  removePlugin: vi.fn(),
}))

vi.mock('../src/lib/auth.tsx', () => ({
  useAuth: () => ({
    can: (permission: string) => auth.permissions.includes(permission),
    session: { user: { roleId: auth.roleId } },
  }),
}))

vi.mock('../src/lib/api.ts', () => ({ api }))

const view: PluginsView = {
  builtins: [{
    id: 'builtin:@acme/disabled',
    scope: 'builtin',
    packageName: '@acme/disabled',
    label: '待添加内置插件',
    description: '尚未启用的内置插件。',
    enabled: false,
    manageable: true,
  }],
  enterprise: [{
    id: 'plugin-enterprise',
    scope: 'enterprise',
    packageName: '@acme/enterprise',
    label: '@acme/enterprise',
    description: '企业专属插件。',
    enabled: true,
    manageable: true,
  }],
}

function renderPage(): void {
  render(<ToastProvider><PluginsPage /></ToastProvider>)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  auth.roleId = 'role-owner'
  auth.permissions = ['plugins.builtin.write', 'plugins.enterprise.write']
})

beforeEach(() => {
  api.plugins.mockResolvedValue(view)
  api.addBuiltinPlugin.mockResolvedValue({ ...view, builtins: view.builtins.map(plugin => ({ ...plugin, enabled: true })) })
})

describe('plugins page scopes', () => {
  it('lets an owner add both built-in and enterprise plugins', async () => {
    renderPage()

    const addBuiltin = await screen.findByRole('button', { name: '添加内置插件' }) as HTMLButtonElement
    expect(addBuiltin.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '添加内置插件' }))
    expect(screen.getByRole('dialog', { name: '添加内置插件' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加并启用' }))
    await waitFor(() => { expect(api.addBuiltinPlugin).toHaveBeenCalledWith('@acme/disabled') })

    fireEvent.click(screen.getByRole('tab', { name: /企业插件/u }))
    expect(await screen.findByText('企业专属插件。')).not.toBeNull()
    expect(screen.getByRole('button', { name: '添加企业插件' })).not.toBeNull()
  })

  it('explains when every built-in plugin is already enabled', async () => {
    api.plugins.mockResolvedValue({ ...view, builtins: view.builtins.map(plugin => ({ ...plugin, enabled: true })) })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '添加内置插件' }))
    expect(await screen.findByText('所有内置插件均已添加并启用，无需重复添加。')).not.toBeNull()
    expect(screen.getByRole('button', { name: '添加并启用' }).disabled).toBe(true)
  })

  it('opens on the enterprise tab for administrators and hides built-in additions', async () => {
    auth.roleId = 'role-admin'
    auth.permissions = ['plugins.enterprise.write']
    renderPage()

    const addEnterprise = await screen.findByRole('button', { name: '添加企业插件' }) as HTMLButtonElement
    expect(addEnterprise.disabled).toBe(false)
    expect(screen.getByRole('tab', { name: /企业插件/u }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: /内置插件/u }))
    expect(await screen.findByText('待添加内置插件')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '添加内置插件' })).toBeNull()
  })
})
