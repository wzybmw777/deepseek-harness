/**
 * Team-scoped files, filesystem skills, and durable knowledge for the
 * enterprise console. Every operation resolves its team from the signed-in
 * user and stays below that team's private tenant root.
 * @module @deepseek-ai/dsh-experimental-enterprise-console/team-resources
 */

import { randomUUID } from 'node:crypto'
import { constants, existsSync, type Dirent, type ReadStream } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, rename, rmdir, unlink, type FileHandle } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { dump as dumpYaml, load as loadYaml } from 'js-yaml'

/** Maximum byte size accepted for one uploaded workspace file. */
export const TEAM_FILE_UPLOAD_BYTES = 20 * 1024 * 1024

/** Maximum byte size accepted when saving an editable text file. */
export const TEAM_FILE_TEXT_BYTES = 2 * 1024 * 1024

/** Maximum byte size accepted for one skill document. */
export const TEAM_SKILL_BYTES = 256 * 1024

/** Maximum byte size accepted for one knowledge article body. */
export const TEAM_KNOWLEDGE_BODY_BYTES = 128 * 1024

const MAX_PATH_SEGMENTS = 32
const MAX_NAME_BYTES = 255
const MAX_KNOWLEDGE_ARTICLES = 500
const MAX_KNOWLEDGE_STORE_BYTES = 4 * 1024 * 1024
const KNOWLEDGE_SKILL_NAME = 'team-knowledge'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const TEAM_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u
const PROC_FD_ROOT = '/proc/self/fd'
const USE_PROC_FD = process.platform === 'linux' && existsSync(PROC_FD_ROOT)
const O_DIRECTORY = constants.O_DIRECTORY ?? 0
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0

const TEXT_EXTENSIONS = new Set([
  '', '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg',
  '.csv', '.tsv', '.log', '.xml', '.html', '.htm', '.css', '.scss', '.less', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.gql', '.env.example', '.diff', '.patch',
])

/** One file-manager entry inside the current team's default workspace. */
export interface TeamFileEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly size: number
  readonly modifiedAt: string
  readonly editable: boolean
}

/** One directory listing plus its parent navigation target. */
export interface TeamFileListing {
  readonly directory: string
  readonly parent: string | null
  readonly entries: TeamFileEntry[]
}

/** UTF-8 text file content returned to the editor. */
export interface TeamTextFile {
  readonly path: string
  readonly name: string
  readonly size: number
  readonly modifiedAt: string
  readonly content: string
  readonly editable: true
}

/** Download metadata and a stream backed by an already-open file descriptor. */
export interface TeamFileDownload {
  readonly name: string
  readonly size: number
  readonly modifiedAt: string
  readonly stream: ReadStream
}

/** Skill catalog entry shown in the resources page. */
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

/** Fields accepted when creating or replacing a user skill. */
export interface TeamSkillInput {
  readonly name: string
  readonly description: string
  readonly instructions: string
}

/** Fields accepted when updating an existing user skill. */
export interface TeamSkillUpdate {
  readonly description: string
  readonly instructions: string
}

/** Knowledge catalog entry without the full article body. */
export interface KnowledgeSummary {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly tags: string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Complete team knowledge article. */
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

interface DirectoryCursor {
  readonly handle: FileHandle
  readonly path: string
}

interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly instructions: string
}

interface KnowledgeStore {
  readonly version: 1
  readonly articles: KnowledgeArticle[]
}

/** A localized resource failure that is safe to send to the console client. */
export class TeamResourceError extends Error {
  /** Create a resource failure with an HTTP status and stable machine code. */
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'TeamResourceError'
  }
}

function failure(status: number, message: string, code: string): never {
  throw new TeamResourceError(status, message, code)
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function mapError(error: unknown): never {
  if (error instanceof TeamResourceError) throw error
  switch (errorCode(error)) {
    case 'ENOENT': failure(404, '资源不存在', 'not_found')
    case 'EEXIST': failure(409, '同名资源已存在', 'already_exists')
    case 'ENOTEMPTY': failure(409, '目录不为空，请先删除目录内容', 'directory_not_empty')
    case 'ELOOP': failure(403, '资源路径包含不允许的符号链接', 'unsafe_path')
    case 'EACCES':
    case 'EPERM': failure(403, '没有权限访问该资源', 'forbidden')
    case 'EISDIR': failure(400, '目标是目录，不能作为文件处理', 'not_a_file')
    case 'ENOTDIR': failure(400, '路径中包含非目录项', 'invalid_path')
    case 'ENAMETOOLONG': failure(400, '资源路径过长', 'invalid_path')
    case 'EFBIG': failure(413, '资源超过允许的大小', 'payload_too_large')
    default: throw error
  }
}

function isSafeName(value: string): boolean {
  return value !== ''
    && value !== '.'
    && value !== '..'
    && !value.startsWith('.')
    && !value.includes('/')
    && !value.includes('\\')
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && Buffer.byteLength(value, 'utf8') <= MAX_NAME_BYTES
}

function isPhysicalName(value: string): boolean {
  return value !== ''
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function splitVirtualPath(value: string, allowRoot: boolean): string[] {
  if (value === '') {
    if (allowRoot) return []
    failure(400, '资源路径不能为空', 'invalid_path')
  }
  if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) {
    failure(400, '资源路径无效', 'unsafe_path')
  }
  const segments = value.split('/')
  if (segments.length > MAX_PATH_SEGMENTS) failure(400, '资源路径层级过深', 'invalid_path')
  for (const segment of segments) {
    if (!isSafeName(segment)) failure(400, '资源路径包含不允许的名称', 'unsafe_path')
  }
  return segments
}

function entryPath(value: string): { readonly directory: string[]; readonly name: string; readonly path: string } {
  const segments = splitVirtualPath(value, false)
  const name = segments.pop()
  if (name === undefined) failure(400, '资源路径不能为空', 'invalid_path')
  return { directory: segments, name, path: [...segments, name].join('/') }
}

function assertTeamId(teamId: string): void {
  if (!TEAM_ID.test(teamId)) failure(400, '团队标识无效', 'invalid_team')
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '') failure(400, `${label}不能为空`, 'invalid_field')
  if (Buffer.byteLength(value, 'utf8') > maximum) failure(413, `${label}超过允许的大小`, 'payload_too_large')
  return value.trim()
}

function normalizeTags(value: readonly string[]): string[] {
  if (value.length > 12) failure(400, '标签最多 12 个', 'invalid_field')
  const tags = value.map(tag => requiredText(tag, '标签', 64))
  return [...new Set(tags)]
}

function cursorEntry(cursor: DirectoryCursor, name: string): string {
  return USE_PROC_FD ? join(PROC_FD_ROOT, String(cursor.handle.fd), name) : join(cursor.path, name)
}

function cursorDirectory(cursor: DirectoryCursor): string {
  return USE_PROC_FD ? join(PROC_FD_ROOT, String(cursor.handle.fd)) : cursor.path
}

async function closeCursor(cursor: DirectoryCursor): Promise<void> {
  await cursor.handle.close()
}

async function openAbsoluteDirectory(path: string, create: boolean): Promise<DirectoryCursor> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const handle = await open(path, constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
  const info = await handle.stat()
  if (!info.isDirectory()) {
    await handle.close()
    failure(400, '资源根不是目录', 'not_a_directory')
  }
  return { handle, path }
}

async function openChildDirectory(cursor: DirectoryCursor, name: string, create: boolean): Promise<DirectoryCursor> {
  const target = cursorEntry(cursor, name)
  if (create) {
    try {
      await mkdir(target, { mode: 0o700 })
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
  }
  const handle = await open(target, constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
  const info = await handle.stat()
  if (!info.isDirectory()) {
    await handle.close()
    failure(400, '资源路径不是目录', 'not_a_directory')
  }
  return { handle, path: join(cursor.path, name) }
}

async function descendDirectories(root: DirectoryCursor, names: readonly string[], create: boolean): Promise<DirectoryCursor> {
  let current = root
  try {
    for (const name of names) {
      const next = await openChildDirectory(current, name, create)
      await closeCursor(current)
      current = next
    }
    return current
  } catch (error) {
    await closeCursor(current).catch(() => undefined)
    throw error
  }
}

async function readDirectory(cursor: DirectoryCursor): Promise<Dirent[]> {
  return await readdir(cursorDirectory(cursor), { withFileTypes: true })
}

async function lstatEntry(cursor: DirectoryCursor, name: string) {
  return await lstat(cursorEntry(cursor, name))
}

async function openFile(cursor: DirectoryCursor, name: string, flags: number, mode?: number): Promise<FileHandle> {
  return mode === undefined
    ? await open(cursorEntry(cursor, name), flags | O_NOFOLLOW)
    : await open(cursorEntry(cursor, name), flags | O_NOFOLLOW, mode)
}

async function readFileBytes(cursor: DirectoryCursor, name: string, maximum: number): Promise<Buffer> {
  const handle = await openFile(cursor, name, constants.O_RDONLY)
  try {
    const info = await handle.stat()
    if (!info.isFile()) failure(400, '资源不是普通文件', 'not_a_file')
    if (info.size > maximum) failure(413, '文件超过可读取的大小', 'payload_too_large')
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function writeNewFile(cursor: DirectoryCursor, name: string, data: Buffer | string): Promise<void> {
  const handle = await openFile(cursor, name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function replaceFile(cursor: DirectoryCursor, name: string, data: Buffer | string): Promise<void> {
  const temporary = `.dsh-resource-${randomUUID()}.tmp`
  try {
    await writeNewFile(cursor, temporary, data)
    await rename(cursorEntry(cursor, temporary), cursorEntry(cursor, name))
  } catch (error) {
    await unlink(cursorEntry(cursor, temporary)).catch(() => undefined)
    throw error
  }
}

async function removeTree(cursor: DirectoryCursor): Promise<void> {
  const entries = await readDirectory(cursor)
  for (const entry of entries) {
    if (!isPhysicalName(entry.name)) continue
    const info = await lstatEntry(cursor, entry.name)
    if (info.isDirectory() && !info.isSymbolicLink()) {
      const child = await openChildDirectory(cursor, entry.name, false)
      try {
        await removeTree(child)
      } finally {
        await closeCursor(child)
      }
      await rmdir(cursorEntry(cursor, entry.name))
    } else {
      await unlink(cursorEntry(cursor, entry.name))
    }
  }
}

function isTextFileName(name: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return TEXT_EXTENSIONS.has(dot < 0 ? '' : lower.slice(dot))
}

function entryFromInfo(path: string, name: string, info: Awaited<ReturnType<typeof lstat>>): TeamFileEntry {
  const kind: TeamFileEntry['kind'] = info.isDirectory() ? 'directory' : 'file'
  return {
    name,
    path,
    kind,
    size: kind === 'directory' ? 0 : Number(info.size),
    modifiedAt: info.mtime.toISOString(),
    editable: kind === 'file' && isTextFileName(name),
  }
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '')
  } catch {
    failure(415, '该文件不是 UTF-8 文本，无法在线编辑', 'not_text')
  }
}

function parseSkillDocument(raw: string): { readonly parsed: ParsedSkill; readonly contentStart: number } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (match?.[1] === undefined) failure(422, '技能文件缺少 YAML frontmatter', 'invalid_skill')
  let metadata: unknown
  try {
    metadata = loadYaml(match[1])
  } catch {
    failure(422, '技能文件的 YAML frontmatter 无效', 'invalid_skill')
  }
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    failure(422, '技能文件的 YAML frontmatter 必须是对象', 'invalid_skill')
  }
  const record = metadata as Record<string, unknown>
  if (typeof record.name !== 'string' || !SKILL_NAME.test(record.name)) {
    failure(422, '技能名称必须是小写短横线格式', 'invalid_skill')
  }
  if (typeof record.description !== 'string' || record.description.trim() === '') {
    failure(422, '技能描述不能为空', 'invalid_skill')
  }
  if (record.whenToUse !== undefined && (typeof record.whenToUse !== 'string' || record.whenToUse.trim() === '')) {
    failure(422, '技能使用时机必须是非空文本', 'invalid_skill')
  }
  return {
    parsed: {
      name: record.name,
      description: record.description.trim(),
      ...(typeof record.whenToUse === 'string' ? { whenToUse: record.whenToUse.trim() } : {}),
      instructions: raw.slice(match[0].length).trim(),
    },
    contentStart: match[0].length,
  }
}

function serializeSkill(name: string, description: string, instructions: string, extra: Record<string, unknown> = {}): string {
  const frontmatter = dumpYaml({ name, description, ...extra, metadata: { managedBy: 'enterprise-console' } }, {
    lineWidth: -1,
    noRefs: true,
  }).trimEnd()
  return `---\n${frontmatter}\n---\n\n${instructions.trim()}\n`
}

function summaryFromArticle(article: KnowledgeArticle): KnowledgeSummary {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    tags: article.tags,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  }
}

function parseKnowledgeStore(raw: string): KnowledgeStore {
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    failure(500, '团队知识库数据无法读取，请联系管理员', 'invalid_knowledge_store')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    failure(500, '团队知识库数据无法读取，请联系管理员', 'invalid_knowledge_store')
  }
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.articles)) {
    failure(500, '团队知识库数据版本不受支持，请联系管理员', 'invalid_knowledge_store')
  }
  const articles = record.articles.map((article): KnowledgeArticle => {
    if (typeof article !== 'object' || article === null || Array.isArray(article)) {
      failure(500, '团队知识库数据无法读取，请联系管理员', 'invalid_knowledge_store')
    }
    const candidate = article as Record<string, unknown>
    if (typeof candidate.id !== 'string'
      || typeof candidate.title !== 'string'
      || typeof candidate.summary !== 'string'
      || typeof candidate.body !== 'string'
      || !Array.isArray(candidate.tags)
      || !candidate.tags.every(tag => typeof tag === 'string')
      || typeof candidate.createdAt !== 'string'
      || typeof candidate.updatedAt !== 'string') {
      failure(500, '团队知识库数据无法读取，请联系管理员', 'invalid_knowledge_store')
    }
    return {
      id: candidate.id,
      title: candidate.title,
      summary: candidate.summary,
      body: candidate.body,
      tags: candidate.tags.map(tag => String(tag)),
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    }
  })
  return { version: 1, articles }
}

function referenceName(title: string, id: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48)
  const suffix = id.replace(/-/gu, '').slice(0, 8)
  return `${slug === '' ? 'article' : slug}-${suffix}.md`
}

/** Filesystem and durable-knowledge owner for one enterprise team. */
export class TeamResources {
  private readonly tenantRoot: string
  private readonly mutationTails = new Map<string, Promise<void>>()

  /**
   * @param tenantRoot - private directory containing one `home` and `documents`
   * tree per team id.
   */
  constructor(tenantRoot: string) {
    this.tenantRoot = resolve(tenantRoot)
  }

  /**
   * List one workspace directory.
   * @param teamId - authenticated team id.
   * @param directory - virtual directory path below the workspace root.
   * @returns the directory's safe entries and navigation target.
   */
  async listFiles(teamId: string, directory = ''): Promise<TeamFileListing> {
    return await this.mapped(async () => {
      const segments = splitVirtualPath(directory, true)
      const root = await this.openArea(teamId, 'files')
      const cursor = await descendDirectories(root, segments, false)
      try {
        const entries: TeamFileEntry[] = []
        for (const entry of await readDirectory(cursor)) {
          if (!isSafeName(entry.name)) continue
          const info = await lstatEntry(cursor, entry.name)
          if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) continue
          entries.push(entryFromInfo([...segments, entry.name].join('/'), entry.name, info))
        }
        entries.sort((left, right) => {
          if (left.kind === right.kind) return left.name.localeCompare(right.name, 'zh-CN')
          return left.kind === 'directory' ? -1 : 1
        })
        return {
          directory: segments.join('/'),
          parent: segments.length === 0 ? null : segments.slice(0, -1).join('/'),
          entries,
        }
      } finally {
        await closeCursor(cursor)
      }
    })
  }

  /**
   * Create a workspace file.
   * @param teamId - authenticated team id.
   * @param directory - existing virtual directory.
   * @param name - non-hidden file name.
   * @param data - uploaded bytes.
   * @returns the created file entry.
   */
  async createFile(teamId: string, directory: string, name: string, data: Buffer): Promise<TeamFileEntry> {
    return await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const directorySegments = splitVirtualPath(directory, true)
      if (!isSafeName(name)) failure(400, '文件名无效或不允许使用隐藏文件', 'unsafe_path')
      if (data.byteLength > TEAM_FILE_UPLOAD_BYTES) failure(413, '上传文件超过 20 MiB 限制', 'payload_too_large')
      const root = await this.openArea(teamId, 'files')
      const cursor = await descendDirectories(root, directorySegments, false)
      try {
        await writeNewFile(cursor, name, data)
        const info = await lstatEntry(cursor, name)
        return entryFromInfo([...directorySegments, name].join('/'), name, info)
      } finally {
        await closeCursor(cursor)
      }
    }))
  }

  /**
   * Create one workspace directory.
   * @param teamId - authenticated team id.
   * @param path - new virtual directory path.
   * @returns the created directory entry.
   */
  async createDirectory(teamId: string, path: string): Promise<TeamFileEntry> {
    return await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const target = entryPath(path)
      const root = await this.openArea(teamId, 'files')
      const cursor = await descendDirectories(root, target.directory, false)
      try {
        await mkdir(cursorEntry(cursor, target.name), { mode: 0o700 })
        const info = await lstatEntry(cursor, target.name)
        return entryFromInfo(target.path, target.name, info)
      } finally {
        await closeCursor(cursor)
      }
    }))
  }

  /**
   * Read a workspace file as strict UTF-8 text.
   * @param teamId - authenticated team id.
   * @param path - virtual file path.
   * @returns editable text and metadata.
   */
  async readTextFile(teamId: string, path: string): Promise<TeamTextFile> {
    return await this.mapped(async () => {
      const target = entryPath(path)
      const root = await this.openArea(teamId, 'files')
      const cursor = await descendDirectories(root, target.directory, false)
      try {
        const bytes = await readFileBytes(cursor, target.name, TEAM_FILE_TEXT_BYTES)
        const info = await lstatEntry(cursor, target.name)
        return {
          path: target.path,
          name: target.name,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          content: decodeUtf8(bytes),
          editable: true,
        }
      } finally {
        await closeCursor(cursor)
      }
    })
  }

  /**
   * Replace an existing text file atomically.
   * @param teamId - authenticated team id.
   * @param path - virtual file path.
   * @param content - complete UTF-8 document.
   * @returns the updated file entry.
   */
  async writeTextFile(teamId: string, path: string, content: string): Promise<TeamFileEntry> {
    return await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      if (Buffer.byteLength(content, 'utf8') > TEAM_FILE_TEXT_BYTES) {
        failure(413, '文件内容超过 2 MiB 在线编辑限制', 'payload_too_large')
      }
      const target = entryPath(path)
      const root = await this.openArea(teamId, 'files')
      const cursor = await descendDirectories(root, target.directory, false)
      try {
        const info = await lstatEntry(cursor, target.name)
        if (info.isSymbolicLink()) failure(403, '不允许编辑符号链接', 'unsafe_path')
        if (!info.isFile()) failure(400, '目标不是普通文件', 'not_a_file')
        await replaceFile(cursor, target.name, content)
        return entryFromInfo(target.path, target.name, await lstatEntry(cursor, target.name))
      } finally {
        await closeCursor(cursor)
      }
    }))
  }

  /**
   * Rename a workspace entry within its current directory.
   * @param teamId - authenticated team id.
   * @param path - existing virtual path.
   * @param name - replacement non-hidden name.
   * @returns the renamed entry.
   */
  async renameEntry(teamId: string, path: string, name: string): Promise<TeamFileEntry> {
    return await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      if (!isSafeName(name)) failure(400, '文件名无效或不允许使用隐藏文件', 'unsafe_path')
      const target = entryPath(path)
      const root = await this.openArea(teamId, 'files')
      const cursor = await descendDirectories(root, target.directory, false)
      try {
        const info = await lstatEntry(cursor, target.name)
        if (info.isSymbolicLink()) failure(403, '不允许移动符号链接', 'unsafe_path')
        const existing = await lstatEntry(cursor, name).catch((error) => {
          if (errorCode(error) === 'ENOENT') return undefined
          throw error
        })
        if (existing !== undefined) failure(409, '同名资源已存在', 'already_exists')
        await rename(cursorEntry(cursor, target.name), cursorEntry(cursor, name))
        return entryFromInfo([...target.directory, name].join('/'), name, await lstatEntry(cursor, name))
      } finally {
        await closeCursor(cursor)
      }
    }))
  }

  /**
   * Delete one file or empty directory from the workspace.
   * @param teamId - authenticated team id.
   * @param path - virtual path.
   */
  async deleteEntry(teamId: string, path: string): Promise<void> {
    await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const target = entryPath(path)
      const root = await this.openArea(teamId, 'files')
      const cursor = await descendDirectories(root, target.directory, false)
      try {
        const info = await lstatEntry(cursor, target.name)
        if (info.isSymbolicLink()) failure(403, '不允许删除符号链接', 'unsafe_path')
        if (info.isDirectory()) await rmdir(cursorEntry(cursor, target.name))
        else await unlink(cursorEntry(cursor, target.name))
      } finally {
        await closeCursor(cursor)
      }
    }))
  }

  /**
   * Open a workspace file for a streamed download.
   * @param teamId - authenticated team id.
   * @param path - virtual file path.
   * @returns a pinned file stream and metadata.
   */
  async openDownload(teamId: string, path: string): Promise<TeamFileDownload> {
    return await this.mapped(async () => {
      const target = entryPath(path)
      const root = await this.openArea(teamId, 'files')
      const cursor = await descendDirectories(root, target.directory, false)
      try {
        const handle = await openFile(cursor, target.name, constants.O_RDONLY)
        const info = await handle.stat()
        if (!info.isFile()) {
          await handle.close()
          failure(400, '目标不是普通文件', 'not_a_file')
        }
        return {
          name: target.name,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          stream: handle.createReadStream({ autoClose: true }),
        }
      } finally {
        await closeCursor(cursor)
      }
    })
  }

  /**
   * List both user-authored and generated skills discovered by DSH.
   * @param teamId - authenticated team id.
   * @returns skill summaries sorted by name.
   */
  async listSkills(teamId: string): Promise<TeamSkillSummary[]> {
    return await this.mapped(async () => {
      const root = await this.openArea(teamId, 'skills')
      try {
        const summaries: TeamSkillSummary[] = []
        for (const entry of await readDirectory(root)) {
          if (!isSafeName(entry.name)) continue
          const info = await lstatEntry(root, entry.name)
          if (info.isSymbolicLink()) continue
          try {
            if (info.isDirectory()) {
              const skill = await this.readSkillFromDirectory(root, entry.name)
              summaries.push(this.skillSummary(skill, info.mtime))
            } else if (info.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name !== 'SKILL.md') {
              const raw = decodeUtf8(await readFileBytes(root, entry.name, TEAM_SKILL_BYTES))
              const parsed = parseSkillDocument(raw).parsed
              summaries.push(this.skillSummary(parsed, info.mtime))
            }
          } catch (error) {
            if (!(error instanceof TeamResourceError)) throw error
          }
        }
        return summaries.sort((left, right) => left.name.localeCompare(right.name))
      } finally {
        await closeCursor(root)
      }
    })
  }

  /**
   * Read one complete skill document by skill name.
   * @param teamId - authenticated team id.
   * @param name - skill name.
   * @returns the parsed skill including instructions.
   */
  async readSkill(teamId: string, name: string): Promise<TeamSkill> {
    if (!SKILL_NAME.test(name)) failure(400, '技能名称无效', 'invalid_skill_name')
    return await this.mapped(async () => {
      const root = await this.openArea(teamId, 'skills')
      try {
        const directoryInfo = await lstatEntry(root, name).catch((error) => {
          if (errorCode(error) === 'ENOENT') return undefined
          throw error
        })
        if (directoryInfo?.isDirectory() && !directoryInfo.isSymbolicLink()) {
          const parsed = await this.readSkillFromDirectory(root, name)
          return {
            ...parsed,
            managedBy: parsed.name === KNOWLEDGE_SKILL_NAME ? 'knowledge' : 'user',
            updatedAt: directoryInfo.mtime.toISOString(),
          }
        }
        const flatName = await this.findFlatSkill(root, name)
        const flatInfo = flatName === undefined ? undefined : await lstatEntry(root, flatName)
        if (flatName !== undefined && flatInfo?.isFile() === true && !flatInfo.isSymbolicLink()) {
          const parsed = parseSkillDocument(decodeUtf8(await readFileBytes(root, flatName, TEAM_SKILL_BYTES))).parsed
          return { ...parsed, managedBy: parsed.name === KNOWLEDGE_SKILL_NAME ? 'knowledge' : 'user', updatedAt: flatInfo.mtime.toISOString() }
        }
        failure(404, '技能不存在', 'not_found')
      } finally {
        await closeCursor(root)
      }
    })
  }

  /**
   * Create one filesystem skill under `<team>/home/skills/<name>/SKILL.md`.
   * @param teamId - authenticated team id.
   * @param input - validated skill fields.
   * @returns the created skill.
   */
  async createSkill(teamId: string, input: TeamSkillInput): Promise<TeamSkill> {
    return await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const name = requiredText(input.name, '技能名称', 80)
      if (!SKILL_NAME.test(name)) failure(400, '技能名称只能使用小写字母、数字和短横线', 'invalid_skill_name')
      if (name === KNOWLEDGE_SKILL_NAME) failure(409, '该技能名称由团队知识库保留', 'reserved_skill')
      const description = requiredText(input.description, '技能描述', 500)
      const instructions = requiredText(input.instructions, '技能正文', TEAM_SKILL_BYTES)
      const root = await this.openArea(teamId, 'skills')
      try {
        const existing = await lstatEntry(root, name).catch((error) => {
          if (errorCode(error) === 'ENOENT') return undefined
          throw error
        })
        if (existing !== undefined) failure(409, '同名技能已存在', 'already_exists')
        const directory = await openChildDirectory(root, name, true)
        try {
          await writeNewFile(directory, 'SKILL.md', serializeSkill(name, description, instructions))
          const info = await lstatEntry(directory, 'SKILL.md')
          return {
            name,
            description,
            instructions: instructions.trim(),
            managedBy: 'user',
            updatedAt: info.mtime.toISOString(),
          }
        } finally {
          await closeCursor(directory)
        }
      } finally {
        await closeCursor(root)
      }
    }))
  }

  /**
   * Replace the editable fields of one user-authored skill.
   * @param teamId - authenticated team id.
   * @param name - existing skill name.
   * @param input - replacement description and instructions.
   * @returns the updated skill.
   */
  async updateSkill(teamId: string, name: string, input: TeamSkillUpdate): Promise<TeamSkill> {
    if (!SKILL_NAME.test(name)) failure(400, '技能名称无效', 'invalid_skill_name')
    if (name === KNOWLEDGE_SKILL_NAME) failure(409, '团队知识库技能由系统维护', 'reserved_skill')
    return await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const description = requiredText(input.description, '技能描述', 500)
      const instructions = requiredText(input.instructions, '技能正文', TEAM_SKILL_BYTES)
      const root = await this.openArea(teamId, 'skills')
      try {
        const directoryInfo = await lstatEntry(root, name).catch((error) => {
          if (errorCode(error) === 'ENOENT') return undefined
          throw error
        })
        if (directoryInfo?.isDirectory() && !directoryInfo.isSymbolicLink()) {
          const directory = await openChildDirectory(root, name, false)
          try {
            const info = await lstatEntry(directory, 'SKILL.md')
            if (!info.isFile() || info.isSymbolicLink()) failure(400, '技能文件不是普通文件', 'not_a_file')
            await replaceFile(directory, 'SKILL.md', serializeSkill(name, description, instructions))
            return {
              name,
              description,
              instructions: instructions.trim(),
              managedBy: 'user',
              updatedAt: (await lstatEntry(directory, 'SKILL.md')).mtime.toISOString(),
            }
          } finally {
            await closeCursor(directory)
          }
        }
        const flatName = await this.findFlatSkill(root, name)
        if (flatName === undefined) failure(404, '技能不存在', 'not_found')
        await replaceFile(root, flatName, serializeSkill(name, description, instructions))
        return {
          name,
          description,
          instructions: instructions.trim(),
          managedBy: 'user',
          updatedAt: (await lstatEntry(root, flatName)).mtime.toISOString(),
        }
      } finally {
        await closeCursor(root)
      }
    }))
  }

  /**
   * Delete one user-authored skill directory.
   * @param teamId - authenticated team id.
   * @param name - existing skill name.
   */
  async deleteSkill(teamId: string, name: string): Promise<void> {
    if (!SKILL_NAME.test(name)) failure(400, '技能名称无效', 'invalid_skill_name')
    if (name === KNOWLEDGE_SKILL_NAME) failure(409, '团队知识库技能由系统维护', 'reserved_skill')
    await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const root = await this.openArea(teamId, 'skills')
      try {
        const info = await lstatEntry(root, name).catch((error) => {
          if (errorCode(error) === 'ENOENT') return undefined
          throw error
        })
        if (info?.isSymbolicLink()) failure(403, '不允许删除符号链接', 'unsafe_path')
        if (info?.isDirectory() === true) {
          const directory = await openChildDirectory(root, name, false)
          try {
            await removeTree(directory)
          } finally {
            await closeCursor(directory)
          }
          await rmdir(cursorEntry(root, name))
          return
        }
        const flatName = await this.findFlatSkill(root, name)
        if (flatName === undefined) failure(404, '技能不存在', 'not_found')
        await unlink(cursorEntry(root, flatName))
      } finally {
        await closeCursor(root)
      }
    }))
  }

  /**
   * List knowledge summaries for one team.
   * @param teamId - authenticated team id.
   * @returns articles ordered by most recent update first.
   */
  async listKnowledge(teamId: string): Promise<KnowledgeSummary[]> {
    return await this.mapped(async () => {
      const store = await this.readKnowledgeStore(teamId)
      return store.articles
        .map(summaryFromArticle)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    })
  }

  /**
   * Read one full knowledge article.
   * @param teamId - authenticated team id.
   * @param id - knowledge article id.
   * @returns the article.
   */
  async readKnowledge(teamId: string, id: string): Promise<KnowledgeArticle> {
    return await this.mapped(async () => {
      const article = (await this.readKnowledgeStore(teamId)).articles.find(candidate => candidate.id === id)
      if (article === undefined) failure(404, '知识条目不存在', 'not_found')
      return article
    })
  }

  /**
   * Create a knowledge article and regenerate the team knowledge skill.
   * @param teamId - authenticated team id.
   * @param input - article fields.
   * @returns the created article.
   */
  async createKnowledge(teamId: string, input: KnowledgeInput): Promise<KnowledgeArticle> {
    return await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const store = await this.readKnowledgeStore(teamId)
      if (store.articles.length >= MAX_KNOWLEDGE_ARTICLES) failure(413, '团队知识条目已达到上限', 'knowledge_limit')
      const now = new Date().toISOString()
      const article: KnowledgeArticle = {
        id: randomUUID(),
        ...this.validateKnowledge(input),
        createdAt: now,
        updatedAt: now,
      }
      await this.writeKnowledgeStore(teamId, { version: 1, articles: [...store.articles, article] })
      await this.syncKnowledgeSkill(teamId, [...store.articles, article])
      return article
    }))
  }

  /**
   * Replace one knowledge article and regenerate the team knowledge skill.
   * @param teamId - authenticated team id.
   * @param id - knowledge article id.
   * @param input - replacement fields.
   * @returns the updated article.
   */
  async updateKnowledge(teamId: string, id: string, input: KnowledgeInput): Promise<KnowledgeArticle> {
    return await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const store = await this.readKnowledgeStore(teamId)
      const index = store.articles.findIndex(candidate => candidate.id === id)
      if (index < 0) failure(404, '知识条目不存在', 'not_found')
      const existing = store.articles[index]
      if (existing === undefined) failure(404, '知识条目不存在', 'not_found')
      const article: KnowledgeArticle = {
        ...existing,
        ...this.validateKnowledge(input),
        updatedAt: new Date().toISOString(),
      }
      const articles = store.articles.map(candidate => candidate.id === id ? article : candidate)
      await this.writeKnowledgeStore(teamId, { version: 1, articles })
      await this.syncKnowledgeSkill(teamId, articles)
      return article
    }))
  }

  /**
   * Delete one knowledge article and regenerate the team knowledge skill.
   * @param teamId - authenticated team id.
   * @param id - knowledge article id.
   */
  async deleteKnowledge(teamId: string, id: string): Promise<void> {
    await this.withTeamMutation(teamId, async () => this.mapped(async () => {
      const store = await this.readKnowledgeStore(teamId)
      if (!store.articles.some(candidate => candidate.id === id)) failure(404, '知识条目不存在', 'not_found')
      const articles = store.articles.filter(candidate => candidate.id !== id)
      await this.writeKnowledgeStore(teamId, { version: 1, articles })
      await this.syncKnowledgeSkill(teamId, articles)
    }))
  }

  private validateKnowledge(input: KnowledgeInput): Omit<KnowledgeArticle, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      title: requiredText(input.title, '知识标题', 200),
      summary: requiredText(input.summary, '知识摘要', 1_000),
      body: requiredText(input.body, '知识正文', TEAM_KNOWLEDGE_BODY_BYTES),
      tags: normalizeTags(input.tags),
    }
  }

  private async readKnowledgeStore(teamId: string): Promise<KnowledgeStore> {
    const cursor = await this.openArea(teamId, 'knowledge')
    try {
      const bytes = await readFileBytes(cursor, 'articles.json', MAX_KNOWLEDGE_STORE_BYTES).catch((error) => {
        if (errorCode(error) === 'ENOENT') return undefined
        throw error
      })
      return bytes === undefined ? { version: 1, articles: [] } : parseKnowledgeStore(decodeUtf8(bytes))
    } finally {
      await closeCursor(cursor)
    }
  }

  private async writeKnowledgeStore(teamId: string, store: KnowledgeStore): Promise<void> {
    const body = `${JSON.stringify(store, null, 2)}\n`
    if (Buffer.byteLength(body, 'utf8') > MAX_KNOWLEDGE_STORE_BYTES) {
      failure(413, '团队知识库总大小超过 4 MiB 限制', 'payload_too_large')
    }
    const cursor = await this.openArea(teamId, 'knowledge')
    try {
      await replaceFile(cursor, 'articles.json', body)
      await chmod(cursorEntry(cursor, 'articles.json'), 0o600)
    } finally {
      await closeCursor(cursor)
    }
  }

  private async syncKnowledgeSkill(teamId: string, articles: readonly KnowledgeArticle[]): Promise<void> {
    const root = await this.openArea(teamId, 'skills')
    try {
      const existing = await lstatEntry(root, KNOWLEDGE_SKILL_NAME).catch((error) => {
        if (errorCode(error) === 'ENOENT') return undefined
        throw error
      })
      if (existing !== undefined) {
        if (existing.isSymbolicLink()) failure(403, '知识技能路径包含符号链接', 'unsafe_path')
        const directory = await openChildDirectory(root, KNOWLEDGE_SKILL_NAME, false)
        try {
          await removeTree(directory)
        } finally {
          await closeCursor(directory)
        }
        await rmdir(cursorEntry(root, KNOWLEDGE_SKILL_NAME))
      }
      if (articles.length === 0) return

      const directory = await openChildDirectory(root, KNOWLEDGE_SKILL_NAME, true)
      try {
        const references = await openChildDirectory(directory, 'references', true)
        try {
          const lines = articles.map((article) => {
            const file = referenceName(article.title, article.id)
            return `- [${article.title}](references/${file}) — ${article.summary}`
          })
          const instructions = [
            '# Team knowledge',
            '',
            'This skill is generated from the enterprise console knowledge base. Read only the reference files relevant to the current question.',
            '',
            ...lines,
          ].join('\n')
          const frontmatter = {
            name: KNOWLEDGE_SKILL_NAME,
            description: 'Search the team-maintained knowledge base for policies, runbooks, and internal operating context.',
            whenToUse: 'Use when the user asks about team-specific procedures, policies, systems, or prior operating decisions.',
          }
          await writeNewFile(directory, 'SKILL.md', serializeSkill(
            frontmatter.name,
            frontmatter.description,
            instructions,
            { whenToUse: frontmatter.whenToUse, metadata: { managedBy: 'enterprise-console', source: 'knowledge' } },
          ))
          for (const article of articles) {
            const file = referenceName(article.title, article.id)
            const body = [
              `# ${article.title}`,
              '',
              `> ${article.summary}`,
              '',
              `Tags: ${article.tags.join(', ') || 'none'}`,
              `Updated: ${article.updatedAt}`,
              '',
              article.body,
              '',
            ].join('\n')
            await writeNewFile(references, file, body)
          }
        } finally {
          await closeCursor(references)
        }
      } finally {
        await closeCursor(directory)
      }
    } finally {
      await closeCursor(root)
    }
  }

  private async readSkillFromDirectory(root: DirectoryCursor, directoryName: string): Promise<ParsedSkill> {
    const directory = await openChildDirectory(root, directoryName, false)
    try {
      const raw = decodeUtf8(await readFileBytes(directory, 'SKILL.md', TEAM_SKILL_BYTES))
      const parsed = parseSkillDocument(raw).parsed
      if (parsed.name !== directoryName) failure(422, '技能 frontmatter 名称与目录不一致', 'invalid_skill')
      return parsed
    } finally {
      await closeCursor(directory)
    }
  }

  private async findFlatSkill(root: DirectoryCursor, name: string): Promise<string | undefined> {
    for (const entry of await readDirectory(root)) {
      if (!isSafeName(entry.name) || entry.name === 'SKILL.md' || !entry.name.toLowerCase().endsWith('.md')) continue
      const info = await lstatEntry(root, entry.name)
      if (!info.isFile() || info.isSymbolicLink()) continue
      try {
        const parsed = parseSkillDocument(decodeUtf8(await readFileBytes(root, entry.name, TEAM_SKILL_BYTES))).parsed
        if (parsed.name === name) return entry.name
      } catch (error) {
        if (!(error instanceof TeamResourceError)) throw error
      }
    }
    return undefined
  }

  private skillSummary(skill: ParsedSkill, modified: Date): TeamSkillSummary {
    return {
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      managedBy: skill.name === KNOWLEDGE_SKILL_NAME ? 'knowledge' : 'user',
      updatedAt: modified.toISOString(),
    }
  }

  private async openArea(teamId: string, area: 'files' | 'skills' | 'knowledge'): Promise<DirectoryCursor> {
    assertTeamId(teamId)
    await mkdir(this.tenantRoot, { recursive: true, mode: 0o700 })
    const teamRootPath = join(this.tenantRoot, teamId)
    const root = await openAbsoluteDirectory(teamRootPath, true)
    const segments = area === 'files'
      ? ['documents', 'deepseek-harness', 'default-workspace']
      : area === 'skills'
        ? ['home', 'skills']
        : ['resources', 'knowledge']
    try {
      return await descendDirectories(root, segments, true)
    } catch (error) {
      await closeCursor(root).catch(() => undefined)
      throw error
    }
  }

  private async withTeamMutation<T>(teamId: string, operation: () => Promise<T>): Promise<T> {
    assertTeamId(teamId)
    const previous = this.mutationTails.get(teamId) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    const tail = current.then(() => undefined, () => undefined)
    this.mutationTails.set(teamId, tail)
    try {
      return await current
    } finally {
      if (this.mutationTails.get(teamId) === tail) this.mutationTails.delete(teamId)
    }
  }

  private async mapped<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      mapError(error)
    }
  }
}
