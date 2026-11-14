/** Read the tenant's Feilian sign-in and answer the product runtime's knowledge-base tools. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'

/** Feilian deployment the vendored plugin talks to. */
const FEILIAN_BASE = 'https://flylink.yituobo.com'
/** Credential record the Feilian plugin writes after a member signs in. */
const CREDENTIAL_KEY = 'feilian-kb/session'
/** Largest credential document accepted from disk. */
const MAX_CREDENTIAL_BYTES = 256 * 1024
/** Longest tool result handed back to the model. */
const MAX_TOOL_TEXT = 20_000
/** Per-call Feilian timeout; a knowledge query waits on the remote model. */
const FEILIAN_TIMEOUT_MS = 90_000

/** One knowledge base the signed-in member can read. */
export interface FeilianKnowledgeBase {
  readonly id: string
  readonly name: string
}

/** The read-only Feilian grant stored for one tenant. */
export interface FeilianSession {
  readonly token: string
  readonly tenantId: string
  readonly knowledgeBases: readonly FeilianKnowledgeBase[]
}

/** A function the model may call during a product run. */
export interface FeilianToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: {
    readonly type: 'object'
    readonly properties: Readonly<Record<string, unknown>>
    readonly required: readonly string[]
    readonly additionalProperties: false
  }
}

const KNOWLEDGE_BASE_ID = {
  type: 'string',
  description: '知识库 id；不传时使用当前登录账号的第一个知识库',
} as const

/** Tool definitions shared by every wire protocol. */
export const FEILIAN_TOOLS: readonly FeilianToolDefinition[] = [
  {
    name: 'feilian_kb_search',
    description: '检索飞链企业知识库并返回带引用的回答。回答企业知识相关问题时优先使用。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '要查询的问题' },
        knowledge_base_id: KNOWLEDGE_BASE_ID,
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'feilian_kb_page',
    description: '读取飞链知识库中的一个编译页面，用于核对原文或补充细节。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '页面路径，例如 index.md 或 summaries/xxx.md' },
        knowledge_base_id: KNOWLEDGE_BASE_ID,
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
]

/** Model-facing guidance appended to every text product system prompt. */
export const FEILIAN_TOOL_GUIDE = [
  '回答企业知识相关问题时，先调用 feilian_kb_search 检索飞链知识库；需要原文或细节时调用 feilian_kb_page 读取页面。',
  '工具返回未登录或不可用时，向用户说明原因并只基于已有材料回答，不要编造引用。',
].join('\n')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Read the Feilian grant a tenant member stored from the sidebar page.
 * @param tenantRoot - private directory holding one subdirectory per team.
 * @param teamId - team whose Harness home carries the credential.
 * @returns the grant, or undefined when the tenant never signed in.
 */
export async function readFeilianSession(tenantRoot: string, teamId: string): Promise<FeilianSession | undefined> {
  if (!/^[a-zA-Z0-9_.-]+$/u.test(teamId)) return undefined
  let text: string
  try { text = await readFile(join(tenantRoot, teamId, 'home', '.credentials.yaml'), 'utf8') } catch { return undefined }
  if (Buffer.byteLength(text) > MAX_CREDENTIAL_BYTES) return undefined
  let document: unknown
  try { document = load(text) } catch { return undefined }
  if (!isRecord(document) || !isRecord(document.records)) return undefined
  const record = document.records[CREDENTIAL_KEY]
  if (!isRecord(record) || !isRecord(record.payload)) return undefined
  const payload = record.payload
  const token = textOf(payload.token)
  if (token === '') return undefined
  const tenantId = isRecord(payload.tenant) ? textOf(payload.tenant.id) : ''
  const knowledgeBases = (Array.isArray(payload.knowledge_bases) ? payload.knowledge_bases : [])
    .filter(isRecord)
    .map(knowledgeBase => ({ id: textOf(knowledgeBase.id), name: textOf(knowledgeBase.name) }))
    .filter(knowledgeBase => knowledgeBase.id !== '')
  return { token, tenantId, knowledgeBases }
}

function detailOf(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    if (typeof body.detail === 'string' && body.detail !== '') return body.detail
    if (isRecord(body.detail)) {
      if (typeof body.detail.message === 'string' && body.detail.message !== '') return body.detail.message
      if (typeof body.detail.code === 'string' && body.detail.code !== '') return body.detail.code
    }
    if (typeof body.error === 'string' && body.error !== '') return body.error
  }
  return fallback
}

async function post(fetchImpl: typeof fetch, token: string, path: string, payload: unknown): Promise<unknown> {
  const response = await fetchImpl(`${FEILIAN_BASE}${path}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(FEILIAN_TIMEOUT_MS),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  let body: unknown = null
  try { body = text === '' ? null : JSON.parse(text) } catch { body = text }
  if (response.status === 401) throw new Error('飞链知识库登录已失效，请在侧边栏「飞链知识库」重新登录')
  if (response.status !== 200) throw new Error(detailOf(body, '飞链知识库请求失败'))
  return body
}

/**
 * Execute one Feilian tool call.
 * @param name - tool name offered to the model.
 * @param input - model-supplied arguments.
 * @param session - signed-in tenant grant.
 * @param fetchImpl - HTTP client, replaceable in tests.
 * @returns tool text for the model.
 * @throws When the request fails or the arguments are unusable.
 */
export async function executeFeilianTool(
  name: string,
  input: Readonly<Record<string, unknown>>,
  session: FeilianSession,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const knowledgeBaseId = textOf(input.knowledge_base_id) || session.knowledgeBases[0]?.id || ''
  if (knowledgeBaseId === '') return '当前飞链账号没有可用的知识库。'
  if (name === 'feilian_kb_search') {
    const question = textOf(input.question).trim()
    if (question === '') throw new Error('缺少 question 参数')
    const result = await post(fetchImpl, session.token, '/api/v1/external/query', { knowledge_base_id: knowledgeBaseId, question })
    const record = isRecord(result) ? result : {}
    return clip(JSON.stringify({
      answer: textOf(record.answer),
      citations: Array.isArray(record.citations) ? record.citations : [],
      trace_id: textOf(record.trace_id),
    }))
  }
  if (name === 'feilian_kb_page') {
    const path = textOf(input.path).trim()
    if (path === '') throw new Error('缺少 path 参数')
    if (session.tenantId === '') throw new Error('飞链登录状态缺少企业信息，请重新登录')
    const result = await post(fetchImpl, session.token, '/api/v1/openkb/page', {
      tenant_id: session.tenantId, knowledge_base_id: knowledgeBaseId, path,
    })
    const record = isRecord(result) ? result : {}
    return clip(textOf(record.content) === '' ? '页面不存在或没有可读内容。' : textOf(record.content))
  }
  throw new Error(`未知工具 ${name}`)
}

function clip(value: string): string {
  return value.length <= MAX_TOOL_TEXT ? value : `${value.slice(0, MAX_TOOL_TEXT)}\n…（内容过长已截断）`
}
