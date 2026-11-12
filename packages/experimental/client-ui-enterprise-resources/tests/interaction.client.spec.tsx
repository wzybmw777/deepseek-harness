// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InteractionView } from '../src/client/InteractionView.tsx'
import { workbenchProducts } from '../src/client/product-api.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('conversation history', () => {
  it('restores a completed agent result and download from its persisted command reference', async () => {
    vi.spyOn(workbenchProducts, 'job').mockResolvedValue({ id: 'job-a', agentId: 'ppt', title: '演示文稿助手', input: '季度汇报', state: 'completed', result: '## 汇报已完成\n\n- 要点一', artifact: 'presentation.pptx', charged: 2.5, error: null, createdAt: '2026-11-08T00:00:00Z' })
    const props = { t, node: { args: '{"kind":"agent","jobId":"job-a"}', outcome: { kind: 'success' } } } as never
    const mounted = render(createElement(InteractionView, props))
    await screen.findByText('汇报已完成')
    expect(screen.getByRole('heading', { level: 2, name: '汇报已完成' })).toBeTruthy()
    expect(screen.getByText('要点一')).toBeTruthy()
    expect(screen.getByRole('link', { name: '下载 PPTX' }).getAttribute('href')).toContain('/product/jobs/job-a/download')
    mounted.unmount()
    render(createElement(InteractionView, props))
    await screen.findByText('汇报已完成')
    expect(screen.getByText('季度汇报')).toBeTruthy()
  })
})
