/** Same-origin client for the enterprise team resource API. */

const API_ROOT = '/enterprise/api'

/** One workspace file-manager entry returned by the API. */
export interface TeamFileEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly size: number
  readonly modifiedAt: string
  readonly editable: boolean
}

/** One directory listing and its parent target. */
export interface TeamFileListing {
  readonly directory: string
  readonly parent: string | null
  readonly entries: TeamFileEntry[]
}

/** Capabilities of the signed-in member for team resource mutations. */
export interface ResourceAccess {
  readonly canWrite: boolean
}

/** UTF-8 text file content returned to the online editor. */
export interface TeamTextFile {
  readonly path: string
  readonly name: string
  readonly size: number
  readonly modifiedAt: string
  readonly content: string
  readonly editable: true
}

/** Skill catalog entry shown by the skills page. */
export interface TeamSkillSummary {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly managedBy: 'user' | 'knowledge'
  readonly updatedAt: string
}

/** Editable skill document. */
export interface TeamSkill extends TeamSkillSummary {
  readonly instructions: string
}

/** Fields accepted when creating a team skill. */
export interface TeamSkillInput {
  readonly name: string
  readonly description: string
  readonly instructions: string
}

/** Knowledge catalog entry without its full body. */
export interface KnowledgeSummary {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly tags: string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Complete knowledge article. */
export interface KnowledgeArticle extends KnowledgeSummary {
  readonly body: string
}

/** Fields accepted when creating or replacing a knowledge article. */
export interface KnowledgeInput {
  readonly title: string
  readonly summary: string
  readonly body: string
  readonly tags: string[]
}

/** Exact token usage for one completed Turn. */
export interface MeteredUsageInput {
  readonly sessionId: string
  readonly turn: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly model?: string
}

/** Result of posting one Turn; `recorded` is false for a duplicate retry. */
export interface MeteredUsageResult {
  readonly recorded: boolean
}

/** Failure returned by the resource API or detected while decoding its response. */
export class ResourceApiError extends Error {
  /** @param status - HTTP status, or zero when no response arrived. */
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message)
    this.name = 'ResourceApiError'
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly body?: Record<string, unknown>
  readonly query?: Readonly<Record<string, string | undefined>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_ROOT}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value)
  }
  const init: RequestInit = { method: options.method ?? 'GET', credentials: 'same-origin' }
  if (options.body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(options.body)
  }
  const response = await fetch(url, init)
  if (response.status === 204) return undefined as T
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ResourceApiError(response.status, 'invalid_response')
  }
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined
    const message = typeof error?.message === 'string' ? error.message : undefined
    const code = typeof error?.code === 'string' ? error.code : 'request_failed'
    if (response.status === 401) window.dispatchEvent(new Event('enterprise:unauthorized'))
    throw new ResourceApiError(response.status, code, message)
  }
  return payload as T
}

/** Team-scoped resource operations used by the three workbench pages. */
export const resourcesApi = {
  /** Read the signed-in member's team resource capabilities. */
  access: (): Promise<ResourceAccess> => request('/resources/access'),
  /** List one workspace directory. */
  files: (path = ''): Promise<TeamFileListing> => request('/resources/files', { query: { path } }),
  /** Read one UTF-8 text file. */
  fileContent: (path: string): Promise<TeamTextFile> => request('/resources/files/content', { query: { path } }),
  /** Replace one text file's contents. */
  writeFile: (path: string, content: string): Promise<TeamFileEntry> => request('/resources/files/content', {
    method: 'PATCH', body: { path, content },
  }),
  /** Create one directory below the workspace root. */
  createDirectory: (path: string): Promise<TeamFileEntry> => request('/resources/files/directory', {
    method: 'POST', body: { path },
  }),
  /** Rename one file or directory without moving it. */
  rename: (path: string, name: string): Promise<TeamFileEntry> => request('/resources/files', {
    method: 'PATCH', body: { path, name },
  }),
  /** Delete one file or directory tree. */
  removeFile: (path: string): Promise<void> => request('/resources/files', { method: 'DELETE', query: { path } }),
  /** List team-authored and knowledge-generated skills. */
  skills: (): Promise<TeamSkillSummary[]> => request('/resources/skills'),
  /** Read one editable skill document. */
  skill: (name: string): Promise<TeamSkill> => request(`/resources/skills/${encodeURIComponent(name)}`),
  /** Create one skill. */
  createSkill: (input: TeamSkillInput): Promise<TeamSkill> => request('/resources/skills', {
    method: 'POST', body: { ...input },
  }),
  /** Replace one user-authored skill. */
  updateSkill: (name: string, input: Omit<TeamSkillInput, 'name'>): Promise<TeamSkill> => request(
    `/resources/skills/${encodeURIComponent(name)}`,
    { method: 'PATCH', body: { ...input } },
  ),
  /** Delete one user-authored skill. */
  removeSkill: (name: string): Promise<void> => request(`/resources/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /** List knowledge summaries. */
  knowledge: (): Promise<KnowledgeSummary[]> => request('/resources/knowledge'),
  /** Read one complete knowledge article. */
  knowledgeArticle: (id: string): Promise<KnowledgeArticle> => request(`/resources/knowledge/${encodeURIComponent(id)}`),
  /** Create one knowledge article and its generated skill content. */
  createKnowledge: (input: KnowledgeInput): Promise<KnowledgeArticle> => request('/resources/knowledge', {
    method: 'POST', body: { ...input },
  }),
  /** Replace one knowledge article and its generated references. */
  updateKnowledge: (id: string, input: KnowledgeInput): Promise<KnowledgeArticle> => request(
    `/resources/knowledge/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: { ...input } },
  ),
  /** Delete one knowledge article and refresh generated references. */
  removeKnowledge: (id: string): Promise<void> => request(`/resources/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Record exact token usage for one completed Turn. */
  recordUsage: (input: MeteredUsageInput): Promise<MeteredUsageResult> => request('/billing/usage', {
    method: 'POST', body: { ...input },
  }),
}

/** Upload one file body into the selected workspace directory. */
export async function uploadResourceFile(directory: string, file: File): Promise<TeamFileEntry> {
  const url = new URL(`${API_ROOT}/resources/files/upload`, window.location.origin)
  if (directory !== '') url.searchParams.set('path', directory)
  url.searchParams.set('name', file.name)
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ResourceApiError(response.status, 'invalid_response')
  }
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined
    throw new ResourceApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'request_failed',
      typeof error?.message === 'string' ? error.message : undefined,
    )
  }
  return payload as TeamFileEntry
}

/** Build the same-origin download URL for one workspace file. */
export function resourceFileDownloadUrl(path: string): string {
  const url = new URL(`${API_ROOT}/resources/files/download`, window.location.origin)
  url.searchParams.set('path', path)
  return `${url.pathname}${url.search}`
}

/** Format a byte count with compact binary units. */
export function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`
  const units = ['KB', 'MB', 'GB'] as const
  let amount = value / 1024
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[index] ?? 'B'}`
}

/** Format an API timestamp for a resource row. */
export function formatResourceTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}
