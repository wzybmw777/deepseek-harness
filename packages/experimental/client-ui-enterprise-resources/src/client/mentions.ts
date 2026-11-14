/** Native @ routing into metered agents. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { CommandClaim } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientSessionContext, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, type ResourcePanelProps } from './common.tsx'
import { ResourceApiError } from './api.ts'
import { marketTransaction, workbenchProducts } from './product-api.ts'

type Translate = ResourcePanelProps['t']
type Item = { kind: 'agent'; id: string; title: string; alias?: string }

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A marketplace choice or interaction retaining its exact chat until acceptance. */
    enterpriseInteraction: unknown
  }
}

function token(item: Item): string { return `@${item.title}` }

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

/** Whether the draft already holds a command chip and cannot take a second claim. */
function hasClaim(ctx: Context, session: ClientSessionContext): boolean {
  const scope = ctx.sessions.scope(session.sessionId)
  return scope !== undefined && ctx.conversation.input.for(scope).state.getSnapshot().phase === 'claimed'
}

/**
 * Name an agent chat after its agent while the session carries no title yet,
 * so the workspace list does not fill with untitled rows. Naming is advisory:
 * a Host refusal must not discard the already recorded interaction.
 * @param ctx - browser services.
 * @param sessionId - chat that received the agent record.
 * @param title - agent name to display.
 * @returns completion of the best-effort rename.
 */
async function nameUntitledSession(ctx: Context, sessionId: SessionId, title: string): Promise<void> {
  if (ctx.sessions.list.getSnapshot().byId[sessionId]?.title != null) return
  await ctx.sessions.using(sessionId, { source: 'enterpriseInteraction' }, async (reference) => {
    await reference.binding.session.rename(title)
  })
}

/**
 * Start a fresh chat without overwriting another chat's draft.
 * @param ctx - browser services.
 * @param item - selected agent.
 * @returns completion of selection.
 */
export async function openProductConversation(ctx: Context, item: Item): Promise<void> {
  const workspace = ctx.workspaces.list.getSnapshot().items[0] ?? await ctx.workspaces.initializeDefault()
  if (!workspace) throw new Error('Choose a project before selecting an agent')
  ctx.uiWorkspace.startSession(workspace.workspaceId, { prompt: `${token(item)} `, whenDraftExists: 'append' })
}

/**
 * Register the same menu and command claim the normal composer uses.
 * @param ctx - root browser services.
 * @param t - owned dictionary.
 * @returns registration disposer.
 */
export function registerProductMentions(ctx: Context, t: Translate): () => void {
  const record = async (sessionId: SessionId, data: object): Promise<void> => {
    const result = await ctx.remote.commands.execute(sessionId, `/enterprise-task ${JSON.stringify(data)}`, [])
    if (!result.ok || !result.value || result.value.result.kind !== 'success') throw new ResourceApiError(0, 'record_unconfirmed', t('mention.recordFailed'))
  }
  const claim = (item: Item): CommandClaim => ({
    name: 'enterprise-product', token: `${token(item)} `, hint: t('mention.materials'), serializeArgs: true,
    async submit(args, actx) {
      if (!args.trim()) return { kind: 'error', text: t('mention.materials') }
      const session = ctx.sessions.sessionOf(actx)
      if (!session) return { kind: 'error', text: t('error.request') }
      try {
        return await ctx.sessions.using(session.sessionId, { source: 'enterpriseInteraction' }, async () => {
          const identity = await workbenchProducts.identity()
          const transaction = await marketTransaction(identity.user, 'run', { agentId: item.id, input: args.trim(), sessionId: session.sessionId })
          const job = await workbenchProducts.run(item.id, args.trim(), transaction.key)
          await record(session.sessionId, { kind: 'agent', jobId: job.id })
          await nameUntitledSession(ctx, session.sessionId, item.title).catch(() => { /* Naming is advisory. */ })
          transaction.complete()
          window.dispatchEvent(new Event('dsh-enterprise-access-changed'))
          return { kind: 'success' as const }
        })
      } catch (caught) { return { kind: 'error', text: describeError(caught, t, 'error.request') } }
    },
  })
  const items = async (): Promise<Item[]> => {
    const market = await workbenchProducts.market()
    return market.agents
      .filter(agent => agent.entitlement?.active)
      .map(agent => ({
        kind: 'agent' as const, id: agent.id, title: agent.title, ...(agent.alias === undefined ? {} : { alias: agent.alias }),
      }))
  }
  const source: InputTriggerSource = {
    trigger: '@', name: 'enterprise-agents', order: -50, showGroupTitle: false,
    async candidates(session, request) {
      if (request.position === 'inline' || hasClaim(ctx, session)) return []
      const catalog = await items()
      request.signal.throwIfAborted()
      const query = request.query.toLocaleLowerCase()
      const recent = recentAgents()
      const rank = (item: Item): number => {
        const index = recent.indexOf(item.id)
        return index === -1 ? recent.length : index
      }
      const matches = catalog.filter(item => `${token(item)} ${item.title} ${item.alias ?? ''}`.toLocaleLowerCase().includes(query))
        .sort((left, right) => rank(left) - rank(right))
      return matches.slice(0, query === '' ? 20 : 30)
        .map(item => ({
          name: item.title,
          label: item.title,
          description: t('mention.agentHint'),
          icon: IconSkillOutlineRegular,
          section: t('mention.agents'),
          value: JSON.stringify(item),
        }))
        .concat(request.query === '' ? [
          { name: t('mention.market'), label: t('mention.market'), description: t('mention.marketHint'), icon: IconSkillOutlineRegular, section: t('mention.agents'), value: 'market' },
        ] : [])
    },
    onPick(pick) {
      const value = pick.candidate.value
      if (value === 'market') { window.dispatchEvent(new CustomEvent('dsh-enterprise-resource-open', { detail: value })); return 'handled' }
      if (!value) return undefined
      const item = JSON.parse(value) as Item
      rememberAgent(item.id)
      return { claim: claim(item) }
    },
    async matchEnter(_session, line, signal, envelope) {
      const matches = (await items()).filter(item => line.startsWith(token(item))
        && (line.length === token(item).length || /^\s/u.test(line.slice(token(item).length))))
      if (matches.length > 1) throw new Error(t('mention.chooseAgain'))
      const found = matches[0]
      signal.throwIfAborted()
      if (!found) return undefined
      if (envelope.attachments > 0) throw new Error(t('mention.attachments'))
      return { claim: claim(found) }
    },
    async matchClaim(_session, spelling, signal) {
      const matches = (await items()).filter(item => token(item) === spelling)
      if (matches.length > 1) throw new Error(t('mention.chooseAgain'))
      const found = matches[0]
      signal.throwIfAborted()
      return found ? claim(found) : undefined
    },
  }
  return ctx.inputTriggers.registerSource(source)
}
