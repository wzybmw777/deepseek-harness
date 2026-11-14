import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executeFeilianTool, readFeilianSession, type FeilianSession } from '../src/feilian-tools.ts'
import { runTextWithTools, type ToolLoopOptions } from '../src/product-tool-loop.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

const session: FeilianSession = { token: 'kb_test', tenantId: 'tenant-1', knowledgeBases: [{ id: 'kb-1', name: '测试库' }] }

async function home(): Promise<{ tenantRoot: string; teamId: string }> {
  const tenantRoot = await mkdtemp(join(tmpdir(), 'zhiliu-feilian-'))
  cleanup.push(async () => { await rm(tenantRoot, { recursive: true, force: true }) })
  const teamId = 'team-test'
  await mkdir(join(tenantRoot, teamId, 'home'), { recursive: true })
  return { tenantRoot, teamId }
}

function fakeFetch(response: { status?: number; body?: unknown }): typeof fetch {
  return async () => new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200 })
}

describe('Feilian tenant credential', () => {
  it('reads the grant the sidebar stored', async () => {
    const { tenantRoot, teamId } = await home()
    await writeFile(join(tenantRoot, teamId, 'home', '.credentials.yaml'), [
      'version: 1',
      'records:',
      '  feilian-kb/session:',
      '    kind: grant',
      '    payload:',
      '      token: kb_test',
      '      tenant: { id: tenant-1 }',
      '      knowledge_bases:',
      '        - { id: kb-1, name: 测试库 }',
      '',
    ].join('\n'))
    await expect(readFeilianSession(tenantRoot, teamId)).resolves.toEqual(session)
  })

  it('returns undefined when the tenant never signed in', async () => {
    const { tenantRoot, teamId } = await home()
    await expect(readFeilianSession(tenantRoot, teamId)).resolves.toBeUndefined()
  })
})

describe('Feilian tools', () => {
  it('searches with the stored grant and keeps citations', async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    const result = await executeFeilianTool('feilian_kb_search', { question: '你们做什么' }, session, (async (url: string, init: RequestInit) => {
      seen.url = url
      seen.init = init
      return new Response(JSON.stringify({ answer: 'A', citations: [{ path: 'a.md' }], trace_id: 't' }), { status: 200 })
    }) as typeof fetch)
    expect(seen.url).toBe('https://flylink.yituobo.com/api/v1/external/query')
    expect(JSON.parse(seen.init?.body as string)).toEqual({ knowledge_base_id: 'kb-1', question: '你们做什么' })
    expect((seen.init?.headers as Record<string, string>).authorization).toBe('Bearer kb_test')
    expect(JSON.parse(result)).toEqual({ answer: 'A', citations: [{ path: 'a.md' }], trace_id: 't' })
  })

  it('reports an expired sign-in', async () => {
    await expect(executeFeilianTool('feilian_kb_search', { question: 'q' }, session, fakeFetch({ status: 401 })))
      .rejects.toThrow('重新登录')
  })

  it('reads one compiled page', async () => {
    const result = await executeFeilianTool('feilian_kb_page', { path: 'index.md' }, session, fakeFetch({ body: { path: 'index.md', content: '# 首页' } }))
    expect(result).toBe('# 首页')
  })
})

describe('text product tool loop', () => {
  function options(protocol: ToolLoopOptions['protocol'], send: ToolLoopOptions['transport']['send']): ToolLoopOptions {
    return {
      protocol, modelName: 'model', system: 'system', userInput: '你好', maxTokens: 100,
      tools: [{ name: 'feilian_kb_search', description: 'search', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false } }],
      transport: { send },
      executeTool: async (name, input) => `${name}:${String(input.question)}`,
    }
  }

  it('runs an OpenAI chat tool round before the answer', async () => {
    const bodies: Record<string, unknown>[] = []
    const answer = await runTextWithTools(options('openai-chat', async (body) => {
      bodies.push(body)
      if (bodies.length === 1) {
        return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'feilian_kb_search', arguments: '{"question":"产品"}' } }] } }] }
      }
      return { choices: [{ message: { role: 'assistant', content: '最终回答' } }] }
    }))
    expect(answer).toBe('最终回答')
    expect(bodies).toHaveLength(2)
    expect((bodies[1]?.messages as unknown[])[3]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'feilian_kb_search:产品' })
  })

  it('runs an Anthropic tool round before the answer', async () => {
    let round = 0
    const answer = await runTextWithTools(options('anthropic-messages', async () => {
      round += 1
      return round === 1
        ? { content: [{ type: 'tool_use', id: 'tool-1', name: 'feilian_kb_search', input: { question: '产品' } }] }
        : { content: [{ type: 'text', text: '最终回答' }] }
    }))
    expect(answer).toBe('最终回答')
    expect(round).toBe(2)
  })
})
