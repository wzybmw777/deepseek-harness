import assert from 'node:assert/strict'
/** Server-side model execution and PPT Master delivery for admitted product tasks. */

import { spawn } from 'node:child_process'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { parseProviderUsage } from './desktop-gateway.ts'
import { HttpError, SECURITY_HEADERS } from './http.ts'
import { decryptCredential } from './security.ts'
import type { EnterpriseStore } from './store.ts'
import type { ProductRunner } from './product-api.ts'
import type { ProductStore } from './product-store.ts'
import type { AgentProduct } from './product-types.ts'
import type { ChannelRecord } from './types.ts'

/** Deployment-owned execution limits and installed PPT Master paths. */
export interface ProductRuntimeConfig {
  readonly root: string
  readonly skillRoot?: string
  readonly python: string
  readonly worker: string
  readonly modelTimeoutMs: number
  readonly exportTimeoutMs: number
  readonly maxOutputTokens: number
  readonly concurrency: number
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function modelText(payload: unknown, channel: ChannelRecord): string {
  if (!record(payload)) throw new HttpError(502, '智能体返回内容格式异常，请重新提交', 'model_response_invalid')
  if (channel.wireProtocol === 'openai-chat' && Array.isArray(payload.choices)) {
    const choice: unknown = payload.choices[0]
    if (record(choice) && record(choice.message) && typeof choice.message.content === 'string') return choice.message.content
  }
  const content: unknown[] = channel.wireProtocol === 'anthropic-messages'
    ? (Array.isArray(payload.content) ? payload.content : [])
    : (Array.isArray(payload.output) ? payload.output : [])
  const texts: string[] = []
  for (const item of content) {
    if (!record(item)) continue
    if (typeof item.text === 'string') texts.push(item.text)
    if (Array.isArray(item.content)) for (const block of item.content) if (record(block) && typeof block.text === 'string') texts.push(block.text)
  }
  if (texts.length > 0) return texts.join('\n')
  throw new HttpError(502, '智能体未返回可用内容，请重新提交', 'model_response_empty')
}

async function boundedResponse(response: Response): Promise<string> {
  if (!response.body) throw new Error('Missing model response body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 4 * 1024 * 1024) throw new HttpError(502, '智能体返回内容超出处理上限', 'model_response_too_large')
      chunks.push(next.value)
    }
  } catch (error) { await reader.cancel(); throw error }
  return Buffer.concat(chunks).toString('utf8')
}

function endpoint(channel: ChannelRecord): URL {
  const base = new URL(channel.baseUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new HttpError(409, '请管理员检查模型渠道地址', 'channel_invalid')
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/`
  return new URL(channel.wireProtocol === 'openai-chat' ? 'chat/completions' : channel.wireProtocol === 'openai-responses' ? 'responses' : 'messages', base)
}

/** Bounded process runner: no model text is interpreted as a command. */
async function python(config: ProductRuntimeConfig, arguments_: readonly string[], input: string, signal: AbortSignal): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(config.python, [...arguments_], { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let output = '', diagnostic = ''
    const kill = (): void => {
      if (!child.pid) return
      try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error) }
    }
    const timer = setTimeout(kill, config.exportTimeoutMs)
    signal.addEventListener('abort', kill, { once: true })
    child.stdout.on('data', (bytes: Buffer) => { output += bytes.toString('utf8'); if (output.length > 256_000) kill() })
    child.stderr.on('data', (bytes: Buffer) => { diagnostic = (diagnostic + bytes.toString('utf8')).slice(-32_000) })
    child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') reject(error) })
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer); signal.removeEventListener('abort', kill)
      if (code === 0) resolve(output)
      else reject(new Error(`PPT Master export exited ${String(code)}: ${diagnostic.slice(-1500)}`))
    })
    child.stdin.end(input)
  })
}

/** Owns in-flight tasks, server-side usage settlement, and private artifact reads. */
export class ProductRuntime implements ProductRunner {
  private readonly active = new Map<string, Promise<void>>()
  private readonly stop = new AbortController()
  private skillInstructions = ''
  private pptReady = false
  private constructor(
    private readonly products: ProductStore, private readonly enterprise: EnterpriseStore,
    private readonly config: ProductRuntimeConfig, private readonly warn: (error: Error) => void,
  ) {}

  /**
   * Load the installed Skill and validate its integrity before enabling PPT products.
   * @param products - product store.
   * @param enterprise - organization catalog.
   * @param config - deployment limits.
   * @param warn - server diagnostics.
   * @returns initialized runtime.
   */
  static async open(
    products: ProductStore, enterprise: EnterpriseStore, config: ProductRuntimeConfig, warn: (error: Error) => void,
  ): Promise<ProductRuntime> {
    const runtime = new ProductRuntime(products, enterprise, config, warn)
    await mkdir(config.root, { recursive: true, mode: 0o700 })
    const skillRoot = config.skillRoot
    if (skillRoot) {
      await python(config, [join(config.skillRoot, 'scripts/attribution_guard.py')], '', runtime.stop.signal)
      const files = ['SKILL.md', 'workflows/routing.md', 'workflows/profiles/quick-generate.md', 'references/plan-core.md',
        'references/canvas-formats.md', 'references/modes/_index.md', 'references/visual-styles/_index.md',
        'references/image-renderings/_index.md', 'templates/icons/README.md', 'templates/charts/chart-vocabulary.md',
        'templates/tables/table-vocabulary.md', 'references/preset-shape-vocabulary.md',
        'references/shared-standards-core.md', 'references/executor-base.md', 'references/semantic-svg.md']
      const references = await Promise.all(files.map(async file => `\n--- ${file} ---\n${await readFile(join(skillRoot, file), 'utf8')}`))
      runtime.skillInstructions = references.join('\n')
      await stat(config.worker)
      // Importing the exporter catches missing Python dependencies during provisioning.
      await python(config, ['-c', 'import pptx, lxml, PIL, yaml, fontTools'], '', runtime.stop.signal)
      runtime.pptReady = true
    }
    return runtime
  }

  /** @param executor - configured output executor. @returns provisioned capability. */
  available(executor: AgentProduct['executor']): boolean { return !this.stop.signal.aborted && (executor === 'text' || (executor === 'ppt-master' && this.pptReady)) }

  /** @param teamId - team. @param userId - member. @param jobId - admitted task. @param product - admitted private revision. */
  start(teamId: string, userId: string, jobId: string, product: AgentProduct): void {
    const task = this.run(teamId, userId, jobId, product).catch((error: unknown) => {
      this.warn(error instanceof Error ? error : new Error(String(error)))
      this.products.updateJob(jobId, this.stop.signal.aborted ? 'interrupted' : 'failed', null, null,
        error instanceof HttpError ? error.message : '任务未完成，请稍后重新提交。')
    }).finally(() => { this.active.delete(jobId) })
    this.active.set(jobId, task)
  }

  private async run(teamId: string, userId: string, jobId: string, product: AgentProduct): Promise<void> {
    if (this.active.size >= this.config.concurrency) throw new HttpError(429, '当前任务较多，请稍后重试', 'execution_busy')
    const catalog = this.enterprise.snapshot()
    const user = catalog.users.find(item => item.id === userId && item.teamId === teamId && item.status === 'active')
    const role = user && catalog.roles.find(item => item.id === user.roleId)
    if (!user || !role?.permissions.includes('workspace.use') || !catalog.teams.some(item => item.id === teamId && item.status === 'active')) throw new HttpError(403, '当前工作空间权限已变化，请联系管理员', 'forbidden')
    this.products.assertRun(teamId, userId, product.id)
    const job = this.products.job(teamId, userId, jobId)
    const model = catalog.models.find(item => item.id === product.modelId && item.status === 'active')
    const channel = model && catalog.channels.find(item => item.id === model.channelId && item.status === 'active')
    if (!model || !channel) throw new HttpError(409, '智能体模型尚未配置，请联系管理员', 'model_unavailable')
    const target = endpoint(channel)
    const credential = channel.encryptedApiKey === '' ? '' : decryptCredential(channel.encryptedApiKey, this.enterprise.credentialKey)
    const system = `${product.systemPrompt}\n\n${product.skill}\n\n${product.executor === 'ppt-master' ? this.skillInstructions + '\n' + PPT_RESPONSE_RULES : '基于用户提供的材料交付完整结果，不捏造数据。'}`
    const userInput = product.executor === 'ppt-master'
      ? `用户明确选择快速生成，直接 SVG 到 PPTX，跳过策略确认。仅使用以下封闭材料，不作外部研究。输出 3 至 6 页，所有未指定设计由你决定。\n\n${job.input}`
      : job.input
    const maxTokens = Math.min(this.config.maxOutputTokens, Math.floor(model.contextWindow / 4))
    if (maxTokens < 1) throw new HttpError(409, '请管理员检查模型上下文配置', 'model_context_invalid')
    const messages = [{ role: 'system', content: system }, { role: 'user', content: userInput }]
    const body = channel.wireProtocol === 'openai-chat' ? { model: model.name, messages, stream: false, max_tokens: maxTokens }
      : channel.wireProtocol === 'openai-responses' ? { model: model.name, input: messages, stream: false, max_output_tokens: maxTokens }
        : { model: model.name, system, messages: [{ role: 'user', content: userInput }], max_tokens: maxTokens, stream: false }
    const serialized = JSON.stringify(body)
    if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw new HttpError(400, '材料和技能说明超出处理上限，请精简内容', 'context_too_large')
    const attempt = this.products.reserve(jobId, teamId, userId, model.contextWindow,
      JSON.stringify({ modelId: model.id, channelId: channel.id, protocol: channel.wireProtocol, body }))
    this.products.updateJob(jobId, 'running')
    let responseBody = '', settled = false
    try {
      const response = await fetch(target, {
        method: 'POST', redirect: 'error',
        signal: AbortSignal.any([this.stop.signal, AbortSignal.timeout(this.config.modelTimeoutMs)]),
        headers: { 'content-type': 'application/json', ...(channel.wireProtocol === 'anthropic-messages' ? { 'x-api-key': credential, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${credential}` }) },
        body: serialized,
      })
      responseBody = await boundedResponse(response)
      const usage = parseProviderUsage(channel.wireProtocol, responseBody)
      this.products.settle(attempt, responseBody, usage ?? null); settled = true
      if (response.status === 401 || response.status === 403) {
        throw new HttpError(502, '模型渠道认证失败，请管理员检查渠道与 API Key', 'provider_auth')
      }
      if (!response.ok) throw new HttpError(502, '模型服务暂时繁忙，请稍后重新提交。', 'provider_failed')
    } catch (error) {
      if (!settled) this.products.settle(attempt, responseBody || 'Request interrupted before complete provider response', null)
      throw error
    }
    const text = modelText(JSON.parse(responseBody), channel)
    if (product.executor === 'text') { this.products.updateJob(jobId, 'completed', text); return }
    const clean = text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
    let payload: unknown
    try { payload = JSON.parse(clean) }
    catch { throw new HttpError(502, '演示文稿内容格式异常，请重新生成。', 'deck_invalid') }
    if (!record(payload) || !Array.isArray(payload.slides) || payload.slides.length < 3 || payload.slides.length > 6
      || !payload.slides.every(item => record(item) && typeof item.svg === 'string' && item.svg.length < 200_000)) throw new HttpError(502, '演示文稿未通过结构校验，请重新生成', 'deck_invalid')
    const directory = join(this.config.root, jobId)
    await mkdir(directory, { mode: 0o700 })
    const skillRoot = this.config.skillRoot
    assert(skillRoot, 'PPT Master requires a provisioned skill root')
    const receiptText = await python(this.config,
      [this.config.worker, skillRoot, directory], JSON.stringify(payload), this.stop.signal)
    const receipt: unknown = JSON.parse(receiptText)
    if (!record(receipt) || !['passed', 'passed-with-warnings'].includes(String(receipt.status))) throw new Error('PPT Master did not return a passing postflight receipt')
    const artifact = join(directory, 'presentation.pptx')
    if ((await stat(artifact)).size === 0) throw new Error('PPT Master returned an empty artifact')
    const summary = typeof payload.summary === 'string' ? payload.summary.slice(0, 4000) : '演示文稿已制作完成，可以下载并继续编辑。'
    this.products.updateJob(jobId, 'completed', summary + (receipt.status === 'passed-with-warnings' ? '\n导出检查提示了兼容差异，请打开文件检查版式。' : ''), 'presentation.pptx')
  }

  /** @param teamId - owner team. @param userId - owner. @param jobId - task. @param response - HTTP response. */
  async download(teamId: string, userId: string, jobId: string, response: ServerResponse): Promise<void> {
    const job = this.products.job(teamId, userId, jobId)
    if (job.state !== 'completed' || job.artifact !== 'presentation.pptx') throw new HttpError(404, '该任务还没有可下载的文件', 'artifact_missing')
    const data = await readFile(join(this.config.root, jobId, 'presentation.pptx'))
    response.writeHead(200, { ...SECURITY_HEADERS, 'cache-control': 'no-store',
      'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'content-disposition': 'attachment; filename="presentation.pptx"', 'content-length': String(data.byteLength) })
    response.end(data)
  }

  /** Abort requests, kill exporter processes, then wait before closing storage. */
  async close(): Promise<void> { this.stop.abort(); await Promise.all(this.active.values()) }
}

const PPT_RESPONSE_RULES = `
本执行器交付 PPT Master 原生可编辑演示文稿。采用 Quick Generate、自由设计、flat 结构。
遵守以上 Skill，先在当前上下文决定每页信息关系、视觉节奏和版式，不输出或持久化设计推理。
仅用用户提供材料。不要补充统计或案例，不需要照片的文字材料采用有意义的排版和几何表达。
此首版执行器只支持无外部资源的 SVG：允许 svg,g,rect,circle,ellipse,line,text,tspan,defs,linearGradient,stop。
每页 1280×720；root 具备 xmlns、viewBox、lang="zh-CN"、font-family="Arial, Microsoft YaHei"、font-size="28"。
root 仅 typography，不设 fill。root data-pptx-page-role 取 cover/content/ending。所有普通 text/shape 使用具体 HEX paint。
用分组表达独立语义单元，每个 root g 有唯一 id 和准确 data-pptx-bounds="x y width height"；所有子元素都在该 bounds 内。
root 背景 rect 独立，id="background"，data-pptx-role="background"。普通标题和正文不标 data-pptx-role。
title 44~64px，body 26~32px，注释至少18px，安全边距64px，文本手动分行、每行不超过约28个中文字符。
每页必须完整，不使用占位词。不要使用 path/polygon、图片、超链接、外部资源、脚本、style/class、滤镜或图表/表格数据替换。
不要创建动画、配音、备注、模板、design_spec 或 spec_lock。保留默认 fade 转场，不启用对象动画。
严格只输出 JSON：{"summary":"简短说明实际风格和用途","slides":[{"svg":"完整 SVG XML"},...]}
3至6页 SVG 依次封面/内容/结尾；绝不输出 markdown、工具调用或 Python。服务端将完成项目初始化、最终质量检查和 PPT Master 导出。
`
