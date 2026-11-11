/** Read the first-party agent catalog the agent-hub bundle ships beside this package. */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { AgentCatalogEntry, AgentCatalogSeed } from './product-store.ts'

/** Built output and sources share the same depth, so one relative path serves both. */
const DEFAULT_CATALOGS = ['agents.json', 'experts.json', 'teams.json'].map(
  name => fileURLToPath(new URL(`../../agent-hub-bundle/catalog/${name}`, import.meta.url)),
)
const ICONS = new Set([
  'spark', 'strategy', 'operations', 'brand', 'growth', 'marketing',
  'finance', 'organization', 'legal', 'image', 'video', 'document', 'chat', 'knowledge',
])

type Warn = (message: string) => void

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function optionalText(value: unknown, field: string): string {
  return value === undefined || value === null ? '' : text(value, field)
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}

function list(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${field} must be a string array`)
  return value as string[]
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`)
  return value
}

function entry(value: unknown): AgentCatalogEntry {
  if (value === null || typeof value !== 'object') throw new Error('catalog entries must be objects')
  const record = value as Record<string, unknown>
  const output = text(record.output, 'output')
  const executor = text(record.executor, 'executor')
  if (output !== 'text' && output !== 'pptx' && output !== 'video') throw new Error(`unsupported output ${output}`)
  if (executor !== 'text' && executor !== 'ppt-master' && executor !== 'video') throw new Error(`unsupported executor ${executor}`)
  const icon = optionalText(record.icon, 'icon') || 'spark'
  if (!ICONS.has(icon)) throw new Error(`unsupported icon ${icon}`)
  const price = count(record.price, 'price')
  const durationDays = record.durationDays === null || record.durationDays === undefined ? null : count(record.durationDays, 'durationDays')
  const kind = record.kind === undefined ? 'agent' : text(record.kind, 'kind')
  if (kind !== 'agent' && kind !== 'expert' && kind !== 'team') throw new Error(`unsupported kind ${kind}`)
  const members = record.members === undefined ? [] : list(record.members, 'members')
  return {
    kind,
    members,
    id: text(record.id, 'id'),
    title: text(record.title, 'title'),
    description: text(record.description, 'description'),
    alias: optionalText(record.alias, 'alias'),
    group: optionalText(record.group, 'group'),
    category: text(record.category, 'category'),
    icon: icon as AgentCatalogEntry['icon'],
    tasks: optionalText(record.tasks, 'tasks'),
    materials: optionalText(record.materials, 'materials'),
    deliverables: optionalText(record.deliverables, 'deliverables'),
    example: optionalText(record.example, 'example'),
    disclaimer: optionalText(record.disclaimer, 'disclaimer'),
    sortOrder: record.sortOrder === undefined ? 100 : count(record.sortOrder, 'sortOrder'),
    recommended: record.recommended === undefined ? false : boolean(record.recommended, 'recommended'),
    output,
    executor,
    price,
    durationDays,
    published: record.published === undefined ? false : boolean(record.published, 'published'),
    modelId: optionalText(record.modelId, 'modelId'),
    systemPrompt: text(record.systemPrompt, 'systemPrompt'),
    skill: text(record.skill, 'skill'),
  }
}

/**
 * Load and validate the shipped catalog files.
 * @param path - one explicit catalog file; defaults to the agent-hub bundle beside this package.
 * @param warn - receives a short diagnostic instead of failing console startup.
 * @returns the catalog with its content version, or undefined when it cannot be read.
 */
export async function loadAgentCatalogSeed(path?: string, warn?: Warn): Promise<AgentCatalogSeed | undefined> {
  const paths = path === undefined ? DEFAULT_CATALOGS : [path]
  const sources: string[] = []
  for (const file of paths) {
    try {
      sources.push(await readFile(file, 'utf8'))
    } catch {
      if (path !== undefined) {
        warn?.(`agent catalog: cannot read ${file}; starting without a seed`)
        return undefined
      }
      warn?.(`agent catalog: skipping missing ${file}`)
    }
  }
  try {
    const agents = sources.flatMap((source) => {
      const parsed: unknown = JSON.parse(source)
      if (!Array.isArray(parsed)) throw new Error('top level must be an array')
      return parsed.map(entry)
    })
    const ids = new Set<string>()
    for (const agent of agents) {
      if (ids.has(agent.id)) throw new Error(`duplicate agent id ${agent.id}`)
      ids.add(agent.id)
    }
    const version = createHash('sha256').update(sources.join('\n')).digest('hex').slice(0, 16)
    return { version, agents }
  } catch (error) {
    warn?.(`agent catalog: ignoring ${paths.join(', ')}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
