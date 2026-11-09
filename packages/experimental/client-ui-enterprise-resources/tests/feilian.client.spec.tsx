// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgePanel } from '../src/client/FeilianPanel.tsx'
import { InteractionView } from '../src/client/InteractionView.tsx'
import { workbenchProducts } from '../src/client/product-api.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('native Feilian and conversation history', () => {
  it('opens accessible libraries directly in the workbench and selects one for chat', async () => {
    vi.spyOn(workbenchProducts, 'feilian').mockResolvedValue({ available: true, bound: true, state: 'connected', knowledgeBases: [{ id: 'kb-a', name: '品牌资料' }] })
    const useKnowledge = vi.fn(async () => {})
    const start = location.href
    render(createElement(KnowledgePanel, { t, useKnowledge } as never))
    fireEvent.click(await screen.findByRole('button', { name: /品牌资料/u }))
    await waitFor(() => { expect(useKnowledge).toHaveBeenCalledWith('kb-a', '品牌资料') })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('飞链知识库')
    expect(location.href).toBe(start)
  })

  it('binds in place, clears the password after success, and displays the resulting libraries', async () => {
    vi.spyOn(workbenchProducts, 'feilian').mockResolvedValueOnce({ available: true, bound: false, state: 'unbound', knowledgeBases: [] })
      .mockResolvedValue({ available: true, bound: true, state: 'connected', knowledgeBases: [{ id: 'kb-a', name: '品牌资料' }] })
    const bind = vi.spyOn(workbenchProducts, 'bindFeilian').mockResolvedValue({})
    render(createElement(KnowledgePanel, { t, useKnowledge: vi.fn() } as never))
    fireEvent.change(await screen.findByLabelText('飞链邮箱'), { target: { value: 'member@example.com' } })
    fireEvent.change(screen.getByLabelText('飞链密码'), { target: { value: 'fixture-password' } })
    fireEvent.click(screen.getByRole('button', { name: '绑定飞链账号' }))
    await screen.findByRole('button', { name: /品牌资料/u })
    expect(bind).toHaveBeenCalledWith('member@example.com', 'fixture-password', '')
    expect(screen.queryByLabelText('飞链密码')).toBeNull()
    expect(sessionStorage.getItem('fixture-password')).toBeNull()
  })

  it('restores a completed agent result and download from its persisted command reference', async () => {
    vi.spyOn(workbenchProducts, 'job').mockResolvedValue({ id: 'job-a', agentId: 'ppt', title: '演示文稿助手', input: '季度汇报', state: 'completed', result: '汇报已完成', artifact: 'presentation.pptx', charged: 2.5, error: null, createdAt: '2026-11-08T00:00:00Z' })
    const props = { t, node: { args: '{"kind":"agent","jobId":"job-a"}', outcome: { kind: 'success' } } } as never
    const mounted = render(createElement(InteractionView, props))
    await screen.findByText('汇报已完成')
    expect(screen.getByRole('link', { name: '下载 PPTX' }).getAttribute('href')).toContain('/product/jobs/job-a/download')
    mounted.unmount()
    render(createElement(InteractionView, props))
    await screen.findByText('汇报已完成')
    expect(screen.getByText('季度汇报')).toBeTruthy()
  })
})
