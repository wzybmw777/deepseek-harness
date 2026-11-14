import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir } from '../src/format.ts'
import { oneTurnLog } from '../../session-persistence/tests/contract.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-delete-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root })
  return { root, ctx, persistence: ctx.sessionPersistence }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('JSONL Session deletion', () => {
  it('removes the stored artifacts and reports whether any directory existed', async () => {
    const { root, ctx, persistence } = await fixture()
    const session = ctx.sessions.create(SessionId('doomed'))
    const handle = await persistence.create(session.header)
    await handle.append(oneTurnLog())
    await handle.close()
    const directory = sessionDir(root, session.header.cwd, session.id)
    expect(await exists(directory)).toBe(true)

    await expect(persistence.delete(session.id)).resolves.toBe(true)
    expect(await exists(directory)).toBe(false)
    expect(await persistence.stat(session.id)).toBeUndefined()
    await expect(persistence.delete(session.id)).resolves.toBe(false)
  })

  it('removes every project generation directory carrying the same Session id', async () => {
    const { root, ctx, persistence } = await fixture()
    const session = ctx.sessions.create(SessionId('multi-project'), { meta: { cwd: '/alpha' } })
    const handle = await persistence.create(session.header)
    await handle.append(oneTurnLog())
    await handle.close()

    const otherCwd = '/beta'
    const otherDirectory = sessionDir(root, otherCwd, session.id)
    await mkdir(otherDirectory, { recursive: true })
    await writeFile(join(otherDirectory, 'events.v1.jsonl'), '{}\n')

    await expect(persistence.delete(session.id)).resolves.toBe(true)
    expect(await exists(sessionDir(root, '/alpha', session.id))).toBe(false)
    expect(await exists(otherDirectory)).toBe(false)
  })

  it('refuses while a write handle owns the Session and succeeds after it closes', async () => {
    const { ctx, persistence } = await fixture()
    const session = ctx.sessions.create(SessionId('owned'))
    const handle = await persistence.create(session.header)
    await handle.append(oneTurnLog())

    await expect(persistence.delete(session.id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    await handle.close()
    await expect(persistence.delete(session.id)).resolves.toBe(true)
  })
})
