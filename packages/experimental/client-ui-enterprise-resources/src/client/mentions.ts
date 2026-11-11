/** Native @ routing into metered products and bound Feilian libraries. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { CommandClaim, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconDatabaseOutlineRegular, IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, type ResourcePanelProps } from './common.tsx'
import { ResourceApiError } from './api.ts'
import { marketTransaction, workbenchProducts } from './product-api.ts'

type Translate = ResourcePanelProps['t']
type Item = { kind: 'agent' | 'knowledge'; id: string; title: string; alias?: string }

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A marketplace choice or interaction retaining its exact chat until acceptance. */
    enterpriseInteraction: unknown
  }
}

function token(item: Item): string { return item.kind === 'agent' ? `@${item.title}` : `@飞链/${item.title}` }
function reference(item: Item, sessionId: SessionId): ReferenceInsert {
  return { source: 'enterprise-products', ref: JSON.stringify({ ...item, sessionId }), label: item.title, appearance: 'session', clipboardText: `@feilian[${encodeURIComponent(item.id)}]` }
}

const RECENT_AGENTS_KEY = 'zhiliu.recentAgents'

function recentAgents(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_AGENTS_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function rememberAgent(id: string): void {
  try {
    const next = [id, ...recentAgents().filter(item => item !== id)].slice(0, 8)
    window.localStorage.setItem(RECENT_AGENTS_KEY, JSON.stringify(next))
  } catch { /* Browser storage is optional for ordering. */ }
}

/**
 * Start a fresh chat without overwriting another chat's draft.
 * @param ctx - browser services.
 * @param item - selected agent or library.
 * @returns completion of selection.
 */
export async function openProductConversation(ctx: Context, item: Item): Promise<void> {
  const workspace = ctx.workspaces.list.getSnapshot().items[0] ?? await ctx.workspaces.initializeDefault()
  if (!workspace) throw new Error('Choose a project before selecting an agent')
  ctx.uiWorkspace.startSession(workspace.workspaceId, { prompt: `${token(item)} `, whenDraftExists: 'append' })
}

/**
 * Register the same menu and reference chips the normal composer uses.
 * @param ctx - root browser services.
 * @param t - owned dictionary.
 * @returns registration disposer.
 */
export function registerProductMentions(ctx: Context, t: Translate): () => void {
  const record = async (sessionId: SessionId, data: object): Promise<void> => {
    const result = await ctx.remote.commands.execute(sessionId, `/enterprise-task ${JSON.stringify(data)}`, [])
    if (!result.ok || !result.value || result.value.result.kind !== 'success') throw new ResourceApiError(0, 'record_unconfirmed', t('mention.recordFailed'))
  }
  const resolveLibraries = async (sessionId: SessionId, input: string): Promise<string> => {
    const scope = ctx.sessions.scope(sessionId)
    if (!scope) throw new ResourceApiError(0, 'session_missing', t('error.request'))
    const state = ctx.conversation.input.for(scope).state.getSnapshot()
    const libraries = state.occurrences.filter(item => item.source === 'enterprise-products')
    let material = input
    for (const library of libraries) {
      const item = JSON.parse(library.ref) as Item
      const question = input.replace(/@feilian\[[^\]]+\]/gu, '').trim()
      if (!question) throw new ResourceApiError(0, 'materials_required', t('mention.materials'))
      const result = await workbenchProducts.queryFeilian(item.id, question)
      material = material.replace(library.clipboardText, '') + `\n\n${t('mention.context', { name: item.title })}\n${result.answer}`
    }
    return material.trim()
  }
  const claim = (item: Item): CommandClaim => ({
    name: 'enterprise-product', token: `${token(item)} `, hint: t('mention.materials'),
    async submit(args, actx) {
      if (!args.trim()) return { kind: 'error', text: t('mention.materials') }
      const session = ctx.sessions.sessionOf(actx)
      if (!session) return { kind: 'error', text: t('error.request') }
      try {
        return await ctx.sessions.using(session.sessionId, { source: 'enterpriseInteraction' }, async () => {
          if (item.kind === 'knowledge') {
            const result = await workbenchProducts.queryFeilian(item.id, args.trim())
            await record(session.sessionId, { kind: 'knowledge', title: item.title, input: args.trim(), answer: result.answer })
          } else {
            const identity = await workbenchProducts.identity()
            const transaction = await marketTransaction(identity.user, 'run', { agentId: item.id, input: args.trim(), sessionId: session.sessionId })
            const input = await resolveLibraries(session.sessionId, args.trim())
            const job = await workbenchProducts.run(item.id, input, transaction.key)
            await record(session.sessionId, { kind: 'agent', jobId: job.id })
            transaction.complete()
            window.dispatchEvent(new Event('dsh-enterprise-access-changed'))
          }
          return { kind: 'success' as const }
        })
      } catch (caught) { return { kind: 'error', text: describeError(caught, t, 'error.request') } }
    },
  })
  const items = async (kind: Item['kind']): Promise<Item[]> => {
    if (kind === 'agent') {
      const market = await workbenchProducts.market()
      return market.agents
        .filter(agent => agent.entitlement?.active)
        .map(agent => ({
          kind, id: agent.id, title: agent.title, ...(agent.alias === undefined ? {} : { alias: agent.alias }),
        }))
    }
    const feilian = await workbenchProducts.feilian()
    return feilian.state === 'connected' ? feilian.knowledgeBases.map(library => ({ kind, id: library.id, title: library.name })) : []
  }
  const makeSource = (kind: Item['kind']): InputTriggerSource => {
    const source: InputTriggerSource = {
      trigger: '@', name: kind === 'agent' ? 'enterprise-agents' : 'enterprise-products',
      order: kind === 'agent' ? -50 : -40, showGroupTitle: false,
      async candidates(_session, request) {
        if (kind === 'agent' && request.position === 'inline') return []
        const catalog = await items(kind)
        request.signal.throwIfAborted()
        const query = request.query.toLocaleLowerCase()
        const recent = kind === 'agent' ? recentAgents() : []
        const rank = (item: Item): number => {
          const index = recent.indexOf(item.id)
          return index === -1 ? recent.length : index
        }
        const matches = catalog.filter(item => (request.position === 'leading' || item.kind === 'knowledge')
          && `${token(item)} ${item.title} ${item.alias ?? ''}`.toLocaleLowerCase().includes(query))
          .sort((left, right) => rank(left) - rank(right))
        return matches.slice(0, query === '' ? 20 : 30)
          .map(item => ({
            name: item.title,
            label: item.title,
            description: item.kind === 'agent' ? t('mention.agentHint') : t('mention.knowledgeHint'),
            icon: item.kind === 'agent' ? IconSkillOutlineRegular : IconDatabaseOutlineRegular,
            section: t(item.kind === 'agent' ? 'mention.agents' : 'knowledge.feilian'),
            value: JSON.stringify(item),
          }))
          .concat(request.position === 'leading' && request.query === '' ? [
            kind === 'agent'
              ? { name: t('mention.market'), label: t('mention.market'), description: t('mention.marketHint'), icon: IconSkillOutlineRegular, section: t('mention.agents'), value: 'market' }
              : { name: t('mention.manageKnowledge'), label: t('mention.manageKnowledge'), description: t('feilian.bindingHint'), icon: IconDatabaseOutlineRegular, section: t('knowledge.feilian'), value: 'knowledge' },
          ] : [])
      },
      onPick(pick) {
        const value = pick.candidate.value
        if (value === 'market' || value === 'knowledge') { window.dispatchEvent(new CustomEvent('dsh-enterprise-resource-open', { detail: value })); return 'handled' }
        if (!value) return undefined
        const item = JSON.parse(value) as Item
        if (item.kind === 'agent') rememberAgent(item.id)
        if (pick.position === 'inline') return { insert: reference(item, pick.session.sessionId) }
        return { claim: claim(item) }
      },
      async matchEnter(_session, line, signal, envelope) {
        if ((kind === 'knowledge') !== line.startsWith('@飞链/')) return undefined
        const matches = (await items(kind)).filter(item => line.startsWith(token(item))
          && (line.length === token(item).length || /^\s/u.test(line.slice(token(item).length))))
        if (matches.length > 1) throw new Error(t('mention.chooseAgain'))
        const found = matches[0]
        signal.throwIfAborted()
        if (!found) return undefined
        if (envelope.attachments > 0) throw new Error(t('mention.attachments'))
        return { claim: claim(found) }
      },
      async matchClaim(_session, spelling, signal) {
        if ((kind === 'knowledge') !== spelling.startsWith('@飞链/')) return undefined
        const matches = (await items(kind)).filter(item => token(item) === spelling)
        if (matches.length > 1) throw new Error(t('mention.chooseAgain'))
        const found = matches[0]
        signal.throwIfAborted()
        return found ? claim(found) : undefined
      },
      codec: {
        clipboardText: (ref) => { const item = JSON.parse(ref) as Item; return `@feilian[${encodeURIComponent(item.id)}]` },
        async serialize(ref, signal) {
          const item = JSON.parse(ref) as Item & { sessionId: SessionId }
          signal.throwIfAborted()
          const actx = ctx.sessions.scope(item.sessionId)
          if (!actx) throw new Error(t('error.request'))
          const question = ctx.conversation.input.for(actx).state.getSnapshot().draft.replace(/@feilian\[[^\]]+\]/gu, '').trim()
          if (!question) throw new ResourceApiError(0, 'materials_required', t('mention.materials'))
          const result = await workbenchProducts.queryFeilian(item.id, question)
          signal.throwIfAborted()
          return `${t('mention.context', { name: item.title })}\n${result.answer}`
        },
      },
    }
    return source
  }
  const stopAgents = ctx.inputTriggers.registerSource(makeSource('agent'))
  const stopKnowledge = ctx.inputTriggers.registerSource(makeSource('knowledge'))
  return () => { stopKnowledge(); stopAgents() }
}
