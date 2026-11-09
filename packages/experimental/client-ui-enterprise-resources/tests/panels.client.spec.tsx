// @vitest-environment jsdom

import { createElement, type ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResourcePanelProps } from '../src/client/common.tsx'
import { FilesPanel } from '../src/client/FilesPanel.tsx'
import { InternalKnowledgePanel as KnowledgePanel } from '../src/client/KnowledgePanel.tsx'
import { SkillsPanel } from '../src/client/SkillsPanel.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestPath(input: RequestInfo | URL): string {
  return new URL(String(input), window.location.origin).pathname
}

function renderPanel(component: ComponentType<ResourcePanelProps>): void {
  render(createElement(component, { t } as ResourcePanelProps))
}

/** Stub fetch and expose the recorded request init for one method/path pair. */
function stubFetch(
  routes: (input: RequestInfo | URL, init?: RequestInit) => Response | undefined,
  canWrite = true,
): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (requestPath(input).endsWith('/resources/access')) return jsonResponse({ canWrite })
    const response = routes(input, init)
    if (response === undefined) throw new Error(`unexpected request: ${requestPath(input)} ${init?.method ?? 'GET'}`)
    return response
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('enterprise resource panels', () => {
  it('browses files and creates a real directory through the API', async () => {
    const directory = {
      name: 'reports',
      path: 'reports',
      kind: 'directory' as const,
      size: 0,
      modifiedAt: '2026-10-31T00:00:00.000Z',
      editable: false,
    }
    let created = false
    const fetcher = stubFetch((input, init) => {
      const path = requestPath(input)
      const method = init?.method ?? 'GET'
      if (path.endsWith('/resources/files') && method === 'GET') {
        return jsonResponse({ directory: '', parent: null, entries: created ? [directory] : [] })
      }
      if (path.endsWith('/resources/files/directory') && method === 'POST') {
        created = true
        return jsonResponse(directory, 201)
      }
      return undefined
    })

    renderPanel(FilesPanel)
    await screen.findByText('文件夹是空的')
    expect(screen.queryByRole('button', { name: '团队文件' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: 'reports' } })
    fireEvent.click(screen.getByRole('button', { name: '创建文件夹' }))

    await screen.findByText('reports')
    expect(screen.getByRole('status').textContent).toContain('文件夹已创建')
    const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post).toBeDefined()
    expect(requestPath(post![0] as RequestInfo | URL)).toBe('/enterprise/api/resources/files/directory')
    expect(JSON.parse(String(post![1]?.body))).toEqual({ path: 'reports' })
  })

  it('keeps duplicate-folder feedback in the dialog field', async () => {
    stubFetch((input, init) => {
      const path = requestPath(input)
      const method = init?.method ?? 'GET'
      if (path.endsWith('/resources/files') && method === 'GET') {
        return jsonResponse({ directory: '', parent: null, entries: [] })
      }
      if (path.endsWith('/resources/files/directory') && method === 'POST') {
        return jsonResponse({ error: { code: 'already_exists', message: '同名资源已存在' } }, 409)
      }
      return undefined
    })

    renderPanel(FilesPanel)
    await screen.findByText('文件夹是空的')
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    const input = screen.getByLabelText('文件夹名称')
    fireEvent.change(input, { target: { value: 'reports' } })
    fireEvent.click(screen.getByRole('button', { name: '创建文件夹' }))

    const dialog = screen.getByRole('dialog', { name: '新建文件夹' })
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('同名资源已存在')
    expect(alert.closest('[data-resource-panel]')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('resource-folder-name-error')
  })

  it('shows upload failures inside the resource panel instead of above it', async () => {
    stubFetch((input, init) => {
      const path = requestPath(input)
      const method = init?.method ?? 'GET'
      if (path.endsWith('/resources/files') && method === 'GET') {
        return jsonResponse({ directory: '', parent: null, entries: [] })
      }
      if (path.endsWith('/resources/files/upload') && method === 'POST') {
        return jsonResponse({ error: { code: 'already_exists', message: '同名资源已存在' } }, 409)
      }
      return undefined
    })

    renderPanel(FilesPanel)
    await screen.findByText('文件夹是空的')
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { files: [new File(['x'], '下载.jpg', { type: 'image/jpeg' })] } })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('同名资源已存在')
    expect(alert.closest('[data-resource-panel]')).not.toBeNull()
  })

  it('creates knowledge and splits comma-separated tags for the generated skill', async () => {
    const existing = {
      id: 'release-process',
      title: '发布流程',
      summary: '团队发布前的检查步骤',
      tags: ['发布'],
      createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:00:00.000Z',
    }
    let created = false
    const fetcher = stubFetch((input, init) => {
      const path = requestPath(input)
      const method = init?.method ?? 'GET'
      if (path.endsWith('/resources/knowledge') && method === 'GET') {
        return jsonResponse(created ? [existing, {
          id: 'incident-process',
          title: '故障响应',
          summary: '先确认影响范围',
          tags: ['运维', '安全'],
          createdAt: '2026-10-31T00:00:00.000Z',
          updatedAt: '2026-10-31T00:00:00.000Z',
        }] : [existing])
      }
      if (path.endsWith('/resources/knowledge') && method === 'POST') {
        created = true
        return jsonResponse({
          id: 'incident-process',
          title: '故障响应',
          summary: '先确认影响范围',
          body: '确认影响范围后通知值班同学。',
          tags: ['运维', '安全'],
          createdAt: '2026-10-31T00:00:00.000Z',
          updatedAt: '2026-10-31T00:00:00.000Z',
        }, 201)
      }
      return undefined
    })

    renderPanel(KnowledgePanel)
    await screen.findByText('发布流程')
    fireEvent.click(screen.getByRole('button', { name: '新建知识' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '故障响应' } })
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '先确认影响范围' } })
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: '运维，安全' } })
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '确认影响范围后通知值班同学。' } })
    fireEvent.click(screen.getByRole('button', { name: '创建知识' }))

    await screen.findByText('故障响应')
    expect(screen.getByRole('status').textContent).toContain('知识条目已创建，团队技能已更新')
    const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post).toBeDefined()
    expect(JSON.parse(String(post![1]?.body))).toEqual({
      title: '故障响应',
      summary: '先确认影响范围',
      body: '确认影响范围后通知值班同学。',
      tags: ['运维', '安全'],
    })
  })

  it('distinguishes team-authored and knowledge-generated skills', async () => {
    const summaries = [
      {
        name: 'release-notes',
        description: '整理发布说明',
        managedBy: 'user',
        updatedAt: '2026-10-30T00:00:00.000Z',
      },
      {
        name: 'team-knowledge',
        description: '团队知识索引',
        managedBy: 'knowledge',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    ] as const
    stubFetch((input, init) => {
      const path = requestPath(input)
      if (path.endsWith('/resources/skills') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse(summaries)
      }
      if (path.endsWith('/resources/skills/team-knowledge')) {
        return jsonResponse({
          ...summaries[1],
          instructions: '# 参考资料\n\n读取团队知识库。',
        })
      }
      return undefined
    })

    renderPanel(SkillsPanel)
    await screen.findByText('release-notes')
    expect(screen.getByText('团队编写')).toBeTruthy()
    expect(screen.getByText('知识库生成')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '删除技能 team-knowledge' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^team-knowledge/ }))
    const dialog = await screen.findByRole('dialog', { name: '查看知识库技能' })
    expect(within(dialog).getByText('该技能由团队知识库自动生成，请到知识库页面修改内容。')).toBeTruthy()
    await waitFor(() => {
      expect(within(dialog).getByLabelText('技能名称').hasAttribute('disabled')).toBe(true)
      expect(within(dialog).getByLabelText('技能正文').hasAttribute('disabled')).toBe(true)
    })
  })

  it('creates a filesystem skill through the workbench API', async () => {
    const created = {
      name: 'incident-runbook',
      description: '处理线上故障',
      instructions: '# 步骤\n\n1. 确认影响范围。',
      managedBy: 'user' as const,
      updatedAt: '2026-10-31T00:00:00.000Z',
    }
    let submitted = false
    const fetcher = stubFetch((input, init) => {
      const path = requestPath(input)
      const method = init?.method ?? 'GET'
      if (path.endsWith('/resources/skills') && method === 'GET') {
        return jsonResponse(submitted ? [created] : [])
      }
      if (path.endsWith('/resources/skills') && method === 'POST') {
        submitted = true
        return jsonResponse(created, 201)
      }
      return undefined
    })

    renderPanel(SkillsPanel)
    await screen.findByText('还没有团队技能')
    fireEvent.click(screen.getAllByRole('button', { name: '新建技能' })[0]!)
    fireEvent.change(screen.getByLabelText('技能名称'), { target: { value: 'incident-runbook' } })
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '处理线上故障' } })
    fireEvent.change(screen.getByLabelText('技能正文'), { target: { value: '# 步骤\n\n1. 确认影响范围。' } })
    fireEvent.click(screen.getByRole('button', { name: '创建技能' }))

    await screen.findByText('incident-runbook')
    expect(screen.getByRole('status').textContent).toContain('技能已创建，DSH 会自动发现')
    const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post).toBeDefined()
    expect(JSON.parse(String(post![1]?.body))).toEqual({
      name: 'incident-runbook',
      description: '处理线上故障',
      instructions: '# 步骤\n\n1. 确认影响范围。',
    })
  })

  it('renders shared resources read-only for members without write access', async () => {
    const fetcher = stubFetch((input, init) => {
      const path = requestPath(input)
      if (path.endsWith('/resources/knowledge') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse([{
          id: 'release-process',
          title: '发布流程',
          summary: '所有者维护的团队流程',
          tags: ['发布'],
          createdAt: '2026-10-30T00:00:00.000Z',
          updatedAt: '2026-10-30T00:00:00.000Z',
        }])
      }
      if (path.endsWith('/resources/knowledge/release-process')) {
        return jsonResponse({
          id: 'release-process',
          title: '发布流程',
          summary: '所有者维护的团队流程',
          body: '由所有者发布。',
          tags: ['发布'],
          createdAt: '2026-10-30T00:00:00.000Z',
          updatedAt: '2026-10-30T00:00:00.000Z',
        })
      }
      return undefined
    }, false)

    renderPanel(KnowledgePanel)
    await screen.findByText('发布流程')
    expect(screen.queryByRole('button', { name: '新建知识' })).toBeNull()
    expect(screen.queryByRole('button', { name: /编辑知识/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除知识/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /发布流程/ }))
    const dialog = await screen.findByRole('dialog', { name: '查看知识' })
    await waitFor(() => {
      expect(within(dialog).getByLabelText('标题').hasAttribute('readonly')).toBe(true)
      expect(within(dialog).getByLabelText('正文').hasAttribute('readonly')).toBe(true)
    })
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull()
    expect(fetcher.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })
})
