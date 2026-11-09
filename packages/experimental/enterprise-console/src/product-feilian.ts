/** Account-scoped adapter to Feilian's existing restricted plugin authorization API. */
import { HttpError } from './http.ts'
import { decryptCredential, encryptCredential } from './security.ts'
import type { ProductStore } from './product-store.ts'

/** Feilian service remains independent of Zhiliu identity and billing. */
export interface FeilianConfig {
  readonly baseUrl?: string
  readonly registrationUrl?: string
  readonly enterpriseUrl?: string
  readonly timeoutMs: number
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function bases(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) throw new HttpError(502, '飞链知识库列表格式异常，请稍后重试', 'feilian_invalid')
  return value.map((item) => {
    if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string') throw new HttpError(502, '飞链知识库列表格式异常', 'feilian_invalid')
    return { id: item.id, name: item.name }
  })
}

/** Restricted credential exchange, revocation, capability discovery, and read-only query. */
export class ProductFeilian {
  private readonly mutating = new Set<string>()
  /**
   * @param products - private binding storage.
   * @param key - console encryption key.
   * @param config - existing independent service endpoints.
   */
  constructor(private readonly products: ProductStore, private readonly key: Buffer, private readonly config: FeilianConfig) {
    for (const address of [config.baseUrl, config.registrationUrl, config.enterpriseUrl]) {
      if (address === undefined) continue
      const url = new URL(address)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Feilian URL')
    }
  }

  private async call(path: string, token?: string, body?: Record<string, unknown>): Promise<unknown> {
    if (!this.config.baseUrl) throw new HttpError(503, '飞链服务尚未配置，请联系管理员', 'feilian_unavailable')
    const target = new URL(path, this.config.baseUrl)
    let response: Response
    try {
      response = await fetch(target, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) })
    } catch { throw new HttpError(502, '飞链服务暂时没有响应，请稍后重试', 'feilian_offline') }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new HttpError(response.status, '请检查飞链账号密码、服务套餐和知识库访问权限，必要时重新绑定', 'feilian_auth_required')
    }
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, '飞链未完成操作，请稍后重试或在飞链查看服务状态', 'feilian_failed') }
    if (!response.body) throw new HttpError(502, '飞链返回内容为空', 'feilian_invalid')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []; let size = 0
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength
        if (size > 2 * 1024 * 1024) throw new HttpError(502, '飞链返回内容超过处理上限', 'feilian_invalid'); chunks.push(next.value) }
    } catch (error) { await reader.cancel(); throw error }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new HttpError(502, '飞链返回内容格式异常', 'feilian_invalid') }
  }

  /**
   * Discover live readable knowledge without exposing the plugin key.
   * @param teamId - Zhiliu team.
   * @param userId - Zhiliu member.
   * @returns public binding state.
   */
  async status(teamId: string, userId: string): Promise<{ available: boolean; bound: boolean; account?: string; state: 'unavailable' | 'unbound' | 'connected' | 'reauth' | 'offline'; knowledgeBases: Array<{ id: string; name: string }>; registrationUrl?: string; enterpriseUrl?: string }> {
    const common = { available: this.config.baseUrl !== undefined,
      ...(this.config.registrationUrl === undefined ? {} : { registrationUrl: this.config.registrationUrl }),
      ...(this.config.enterpriseUrl === undefined ? {} : { enterpriseUrl: this.config.enterpriseUrl }) }
    const binding = this.products.binding(teamId, userId)
    if (!this.config.baseUrl || !binding) return { ...common, bound: false, state: this.config.baseUrl ? 'unbound' : 'unavailable', knowledgeBases: [] }
    try {
      const payload = await this.call('/api/v1/external/capabilities', decryptCredential(binding.encryptedKey, this.key))
      if (!record(payload)) throw new HttpError(502, '飞链返回格式异常', 'feilian_invalid')
      return { ...common, bound: true, account: binding.account, state: 'connected', knowledgeBases: bases(payload.knowledge_bases) }
    } catch (error) {
      if (!(error instanceof HttpError)) throw error
      return { ...common, bound: true, account: binding.account, state: error.code === 'feilian_auth_required' ? 'reauth' : 'offline', knowledgeBases: [] }
    }
  }

  /**
   * Exchange a user's password once for a restricted read/query credential.
   * @param teamId - Zhiliu team.
   * @param userId - Zhiliu member.
   * @param email - Feilian account.
   * @param password - submitted password, not retained.
   * @param tenantSlug - optional Feilian workspace discriminator.
   */
  async bind(teamId: string, userId: string, email: string, password: string, tenantSlug?: string): Promise<void> {
    const owner = `${teamId}:${userId}`
    if (this.mutating.has(owner)) throw new HttpError(409, '绑定操作正在处理中，请稍候', 'feilian_busy')
    this.mutating.add(owner)
    try {
      if (this.products.binding(teamId, userId)) throw new HttpError(409, '请先解除当前绑定，再绑定账号', 'feilian_already_bound')
      const payload = await this.call('/api/v1/plugin/auth/login', undefined, { email, password, device_name: '织流知识库', ...(tenantSlug ? { tenant_slug: tenantSlug } : {}) })
      if (!record(payload) || typeof payload.token !== 'string' || !payload.token.startsWith('kb_')) throw new HttpError(502, '飞链授权返回格式异常，请在飞链检查插件授权', 'feilian_invalid')
      bases(payload.knowledge_bases)
      // The elevated member_token deliberately stays out of storage and client responses.
      this.products.bind(teamId, userId, email, encryptCredential(payload.token, this.key))
    } finally { this.mutating.delete(owner) }
  }

  /** Revoke the remote plugin key before removing a live binding. @param teamId - team. @param userId - member. */
  async unbind(teamId: string, userId: string): Promise<void> {
    const owner = `${teamId}:${userId}`
    if (this.mutating.has(owner)) throw new HttpError(409, '绑定操作正在处理中，请稍候', 'feilian_busy')
    this.mutating.add(owner)
    try {
      const binding = this.products.binding(teamId, userId)
      if (!binding) return
      try { await this.call('/api/v1/plugin/auth/revoke', decryptCredential(binding.encryptedKey, this.key), {}) }
      catch (error) { if (!(error instanceof HttpError) || error.status !== 401) throw error }
      this.products.unbind(teamId, userId)
    } finally { this.mutating.delete(owner) }
  }

  /**
   * Query an explicitly selected readable KB; Feilian owns its usage billing.
   * @param teamId - team.
   * @param userId - member.
   * @param knowledgeBaseId - selected KB.
   * @param question - user query.
   * @returns answer text.
   */
  async query(teamId: string, userId: string, knowledgeBaseId: string, question: string): Promise<{ answer: string }> {
    const binding = this.products.binding(teamId, userId)
    if (!binding) throw new HttpError(409, '请先绑定飞链知识库', 'feilian_unbound')
    const payload = await this.call('/api/v1/external/query', decryptCredential(binding.encryptedKey, this.key), { knowledge_base_id: knowledgeBaseId, question })
    if (!record(payload) || typeof payload.answer !== 'string') throw new HttpError(502, '飞链未返回知识库回答', 'feilian_invalid')
    return { answer: payload.answer }
  }
}
