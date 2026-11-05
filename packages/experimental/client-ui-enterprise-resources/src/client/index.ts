/** Browser entry for the team files, knowledge, and skills main panels. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { FilesPanel } from './FilesPanel.tsx'
import { KnowledgePanel } from './KnowledgePanel.tsx'
import { SkillsPanel } from './SkillsPanel.tsx'
import { reportTurnUsage } from './usage-reporter.ts'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'

/** Sidebar-to-workbench event that requests one resource panel. */
export const RESOURCE_OPEN_EVENT = 'dsh-enterprise-resource-open'

/** Workbench-to-sidebar event that reports the selected resource panel. */
export const RESOURCE_ACTIVE_EVENT = 'dsh-enterprise-resource-active'

/** Main-panel keys shared with the enterprise sidebar bridge. */
export const RESOURCE_PANEL_IDS = {
  files: 'enterprise-files' as MainPanelId,
  knowledge: 'enterprise-knowledge' as MainPanelId,
  skills: 'enterprise-skills' as MainPanelId,
} as const

/** The three resources addressable from the enterprise sidebar. */
export type ResourceKind = keyof typeof RESOURCE_PANEL_IDS

/** Required services: the slot registry, locale dictionaries, and panel navigation. */
export const inject = ['slots', 'locale', 'layout', 'sessions']

function resourceKind(value: unknown): ResourceKind | undefined {
  return value === 'files' || value === 'knowledge' || value === 'skills' ? value : undefined
}

function activeKind(panelId: MainPanelId | null): ResourceKind | null {
  if (panelId === RESOURCE_PANEL_IDS.files) return 'files'
  if (panelId === RESOURCE_PANEL_IDS.knowledge) return 'knowledge'
  if (panelId === RESOURCE_PANEL_IDS.skills) return 'skills'
  return null
}

/**
 * Register the resource pages and bridge the workbench sidebar's same-document
 * navigation event to `ctx.layout`. The Host half stays inert; this browser
 * entry publishes the three panel keys and their team-scoped CRUD surfaces.
 * @param ctx - Client Context with slots, locale, and layout available.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'enterprise-resources: dictionaries')
  ctx.effect(() => reportTurnUsage(ctx), 'enterprise-resources: turn usage')
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main',
      key: RESOURCE_PANEL_IDS.files,
      locale: NS,
    }, FilesPanel)
    yield ctx.slots.register({
      name: 'main',
      key: RESOURCE_PANEL_IDS.knowledge,
      locale: NS,
    }, KnowledgePanel)
    yield ctx.slots.register({
      name: 'main',
      key: RESOURCE_PANEL_IDS.skills,
      locale: NS,
    }, SkillsPanel)

    const publishActive = (panelId: MainPanelId | null): void => {
      window.dispatchEvent(new CustomEvent(RESOURCE_ACTIVE_EVENT, { detail: activeKind(panelId) }))
    }
    const onOpen = (event: Event): void => {
      const kind = resourceKind((event as CustomEvent<unknown>).detail)
      if (kind === undefined) return
      const panelId = RESOURCE_PANEL_IDS[kind]
      const registered = ctx.slots.entries('main').some(entry => entry.options.key === panelId)
      if (!registered) return
      ctx.layout.selectPanel(panelId)
    }
    const unsubscribe = ctx.layout.panelInfo.subscribe(() => {
      publishActive(ctx.layout.panelInfo.getSnapshot().activePanelId)
    })
    window.addEventListener(RESOURCE_OPEN_EVENT, onOpen)
    publishActive(ctx.layout.panelInfo.getSnapshot().activePanelId)
    yield () => {
      window.removeEventListener(RESOURCE_OPEN_EVENT, onOpen)
      unsubscribe()
    }
  })
}

export type { EnterpriseResourcesKey } from './locales.ts'
