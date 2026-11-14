/** `@` source offering the signed-in member's Feilian knowledge bases. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InputTriggerCandidate, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ResourcePanelProps } from './common.tsx'

type Translate = ResourcePanelProps['t']

/** Same-origin route the Feilian plugin's host half serves the menu state on. */
const STATE_PATH = 'api/feilian-kb/state'
/** Menu identity and the owner name stamped on every chip this source inserts. */
export const FEILIAN_KB_SOURCE = 'feilian-knowledge'
/** Candidate value that opens the plugin's sign-in page instead of inserting a chip. */
const SIGN_IN_VALUE = 'sign-in'
/** Reference prefix; a chip persists as `<prefix><id>:<name>`, both URI-encoded. */
const REFERENCE_PREFIX = 'feilian-kb:'
/** How long a signed-in answer feeds the menu before it is fetched again. */
const SIGNED_IN_TTL_MS = 60_000
/** Short reuse of a signed-out answer so signing in from the sidebar shows up right away. */
const SIGNED_OUT_TTL_MS = 10_000
/** Short reuse of an unreachable answer so a missing plugin is not retried per keystroke. */
const UNREACHABLE_TTL_MS = 15_000
/** Main-panel key the Feilian plugin registers its sign-in and browsing page under. */
const PANEL_ID = 'feilian-kb' as MainPanelId

/** One knowledge base the member may read. */
export interface FeilianKnowledgeBase {
  readonly id: string
  readonly name: string
}

/** What the menu needs from the plugin: reachability, sign-in, and the readable bases. */
interface FeilianMenuState {
  readonly available: boolean
  readonly signedIn: boolean
  readonly knowledgeBases: readonly FeilianKnowledgeBase[]
}

const UNREACHABLE: FeilianMenuState = { available: false, signedIn: false, knowledgeBases: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Project the plugin's `state` answer onto what the menu shows. */
function menuStateOf(body: unknown): FeilianMenuState {
  if (!isRecord(body)) return UNREACHABLE
  const knowledgeBases = (Array.isArray(body.knowledge_bases) ? body.knowledge_bases : [])
    .filter(isRecord)
    .map(item => ({ id: textOf(item.id), name: textOf(item.name) }))
    .filter(item => item.id !== '' && item.name !== '')
  return { available: true, signedIn: body.signed_in === true, knowledgeBases }
}

/**
 * Model-facing form of one chip: the base name for readers, and the id the
 * Feilian tools take as `knowledge_base_id`.
 * @param knowledgeBase - chosen base.
 * @returns the serialized reference.
 */
export function knowledgeBaseTag(knowledgeBase: FeilianKnowledgeBase): string {
  return `@${knowledgeBase.name} [飞链知识库 id=${knowledgeBase.id}]`
}

/**
 * Find the next serialized reference at or after `from` so the message view can
 * render it as a chip again.
 * @param text - original message text.
 * @param from - inclusive start offset.
 * @returns the match range and its base, or undefined.
 */
export function matchKnowledgeBaseTag(
  text: string, from: number,
): { readonly start: number; readonly end: number; readonly data: FeilianKnowledgeBase } | undefined {
  const pattern = /@([^\s@[\]]+) \[飞链知识库 id=([^\]\s]+)\]/gu
  pattern.lastIndex = from
  const match = pattern.exec(text)
  if (match === null) return undefined
  const name = match[1] ?? ''
  const id = match[2] ?? ''
  if (name === '' || id === '') return undefined
  return { start: match.index, end: match.index + match[0].length, data: { id, name } }
}

/** Encode one knowledge base as the chip reference this source owns. */
function referenceOf(knowledgeBase: FeilianKnowledgeBase): string {
  return `${REFERENCE_PREFIX}${encodeURIComponent(knowledgeBase.id)}:${encodeURIComponent(knowledgeBase.name)}`
}

/** Read one chip reference back; undefined when it was not written by this source. */
function knowledgeBaseOf(ref: string | undefined): FeilianKnowledgeBase | undefined {
  if (ref === undefined || !ref.startsWith(REFERENCE_PREFIX)) return undefined
  const separator = ref.indexOf(':', REFERENCE_PREFIX.length)
  if (separator < 0) return undefined
  try {
    const id = decodeURIComponent(ref.slice(REFERENCE_PREFIX.length, separator))
    const name = decodeURIComponent(ref.slice(separator + 1))
    return id === '' || name === '' ? undefined : { id, name }
  } catch { return undefined }
}

/** Read one candidate's opaque payload. */
function candidateOf(value: string | undefined): FeilianKnowledgeBase | undefined {
  if (value === undefined || value === SIGN_IN_VALUE) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return undefined
    const id = textOf(parsed.id)
    const name = textOf(parsed.name)
    return id === '' || name === '' ? undefined : { id, name }
  } catch { return undefined }
}

/** How long one fetched answer may be reused. */
function ttlOf(state: FeilianMenuState): number {
  return !state.available ? UNREACHABLE_TTL_MS : state.signedIn ? SIGNED_IN_TTL_MS : SIGNED_OUT_TTL_MS
}

async function readState(): Promise<FeilianMenuState> {
  try {
    const response = await fetch(STATE_PATH, {
      cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' },
    })
    if (!response.ok) return UNREACHABLE
    return menuStateOf(await response.json())
  } catch { return UNREACHABLE }
}

/** Show the Feilian plugin's panel when the deployment mounted it. */
function openFeilianPage(ctx: Context): void {
  if (!ctx.slots.entries('main').some(entry => entry.options.key === PANEL_ID)) return
  ctx.layout.selectPanel(PANEL_ID)
}

/**
 * Register the `@` group that scopes one question to a Feilian knowledge base.
 * The chip serializes into a tag the model reads, so the plugin's own
 * `feilian_kb_search` / `feilian_kb_page` tools answer from that base.
 * @param ctx - root browser services.
 * @param t - owned dictionary.
 * @returns registration disposer.
 */
export function registerFeilianMentions(ctx: Context, t: Translate): () => void {
  let cached: { readonly at: number; readonly state: FeilianMenuState } | undefined
  let pending: Promise<FeilianMenuState> | undefined
  const state = async (): Promise<FeilianMenuState> => {
    const now = Date.now()
    if (cached !== undefined && now - cached.at < ttlOf(cached.state)) return cached.state
    pending ??= readState()
      .then((next) => { cached = { at: Date.now(), state: next }; return next })
      .finally(() => { pending = undefined })
    return await pending
  }
  const section = t('mention.knowledge')
  const source: InputTriggerSource = {
    trigger: '@', name: FEILIAN_KB_SOURCE, order: -40, showGroupTitle: false,
    async candidates(_session, request) {
      const current = await state()
      request.signal.throwIfAborted()
      if (!current.available) return []
      if (!current.signedIn) {
        return [{
          name: t('mention.knowledgeSignIn'),
          description: t('mention.knowledgeSignInHint'),
          icon: IconDatabaseOutlineRegular,
          section,
          value: SIGN_IN_VALUE,
        }]
      }
      const query = request.query.trim().toLocaleLowerCase()
      return current.knowledgeBases
        .filter(knowledgeBase => query === '' || knowledgeBase.name.toLocaleLowerCase().includes(query))
        .map((knowledgeBase): InputTriggerCandidate => ({
          name: knowledgeBase.name,
          label: knowledgeBase.name,
          description: t('mention.knowledgeHint'),
          icon: IconDatabaseOutlineRegular,
          section,
          value: JSON.stringify(knowledgeBase),
        }))
    },
    onPick(pick) {
      const value = pick.candidate.value
      if (value === SIGN_IN_VALUE) { openFeilianPage(ctx); return 'handled' }
      const knowledgeBase = candidateOf(value)
      if (knowledgeBase === undefined) return undefined
      return {
        insert: {
          source: FEILIAN_KB_SOURCE,
          ref: referenceOf(knowledgeBase),
          label: knowledgeBase.name,
          clipboardText: `@${knowledgeBase.name}`,
        },
      }
    },
    warm() { void state() },
    codec: {
      clipboardText: ref => `@${knowledgeBaseOf(ref)?.name ?? ref}`,
      serialize: (ref, signal) => {
        signal.throwIfAborted()
        const knowledgeBase = knowledgeBaseOf(ref)
        return Promise.resolve(knowledgeBase === undefined ? ref : knowledgeBaseTag(knowledgeBase))
      },
    },
  }
  return ctx.inputTriggers.registerSource(source)
}
