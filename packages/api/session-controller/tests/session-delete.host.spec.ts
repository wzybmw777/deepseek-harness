/**
 * Session deletion: ordinary Sessions lose their stored artifacts and
 * Workspace accounting, running work refuses first, and a live idle Agent is
 * torn down before the artifacts go away.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision, type SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

function header(id: string, cwd = '/workspace'): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, isSeeded: false, cwd }
}

function snapshot(id: string): SessionPersistenceSnapshot {
  return { header: header(id), revision: SessionPersistenceRevision(`test:${id}`) }
}

async function baseContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  return ctx
}

function provideRegistry(ctx: Context) {
  const forgetSession = vi.fn(async () => {})
  ctx.provide('workspaceRegistry', {
    get: () => undefined, list: () => [], archivedSessionIds: [], forgetSession,
  } as never)
  return forgetSession
}

function providePersistence(
  ctx: Context,
  stored: SessionHeader | undefined,
  remove: (sessionId: SessionId) => Promise<boolean> = async () => true,
) {
  const deleteStored = vi.fn(remove)
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve(stored === undefined ? [] : [stored]),
    stat: (sessionId: SessionId) => Promise.resolve(
      stored !== undefined && stored.id === sessionId ? snapshot(sessionId) : undefined,
    ),
    delete: deleteStored,
  }) as never)
  return deleteStored
}

describe('sessions.delete', () => {
  it('removes a cold Session and clears its Workspace accounting', async () => {
    const ctx = await baseContext()
    try {
      const sessionId = SessionId('cold-delete')
      const forgetSession = provideRegistry(ctx)
      const deleteStored = providePersistence(ctx, header(sessionId))
      const agents = new ApiSessionAgentController(ctx, () => true)
      const controller = new SessionCommandController(ctx, agents, '/default')

      await expect(controller.delete({ sessionId })).resolves.toEqual({ deleted: true })
      expect(deleteStored).toHaveBeenCalledWith(sessionId)
      expect(forgetSession).toHaveBeenCalledWith(sessionId)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reports not-found without touching storage when neither a log nor a live Agent exists', async () => {
    const ctx = await baseContext()
    try {
      const sessionId = SessionId('missing-delete')
      provideRegistry(ctx)
      const deleteStored = providePersistence(ctx, undefined)
      const agents = new ApiSessionAgentController(ctx, () => true)
      const controller = new SessionCommandController(ctx, agents, '/default')

      await expect(controller.delete({ sessionId })).rejects.toMatchObject({
        code: 'session/not-found', details: { sessionId },
      })
      expect(deleteStored).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses running work without disposing the Agent or deleting artifacts', async () => {
    const ctx = await baseContext()
    try {
      const sessionId = SessionId('busy-delete')
      provideRegistry(ctx)
      const deleteStored = providePersistence(ctx, header(sessionId))
      ctx.on('workspace/session-activity', async () => [{ kind: 'turn' } as never])
      const agents = new ApiSessionAgentController(ctx, () => true)
      const dispose = vi.spyOn(agents, 'disposeAgent')
      const controller = new SessionCommandController(ctx, agents, '/default')

      await expect(controller.delete({ sessionId })).rejects.toMatchObject({
        code: 'session/active', details: { sessionId },
      })
      expect(dispose).not.toHaveBeenCalled()
      expect(deleteStored).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('disposes a live idle Agent before removing its stored artifacts', async () => {
    const ctx = await baseContext()
    try {
      const sessionId = SessionId('live-delete')
      provideRegistry(ctx)
      const order: string[] = []
      const deleteStored = providePersistence(ctx, header(sessionId), async () => {
        order.push('delete')
        return true
      })
      const session = ctx.sessions.create(sessionId, { meta: header(sessionId) })
      await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
      const agents = new ApiSessionAgentController(ctx, () => true)
      vi.spyOn(agents, 'disposeAgent').mockImplementation(async () => { order.push('dispose') })
      const controller = new SessionCommandController(ctx, agents, '/default')

      await expect(controller.delete({ sessionId })).resolves.toEqual({ deleted: true })
      expect(order).toEqual(['dispose', 'delete'])
      expect(deleteStored).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps created handles so disposeAgent tears down exactly once', async () => {
    const ctx = await baseContext()
    try {
      const dispose = vi.fn(async () => {})
      ctx.agents.setFactory({
        createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
          const session = ctx.sessions.create(options.sessionId, {
            ...options.seed === undefined ? {} : { seed: [...options.seed] },
            ...options.meta === undefined ? {} : { meta: options.meta },
          })
          const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
          await ctx.agents.register(agent)
          return { agent, dispose }
        },
        resume: () => Promise.reject(new Error('resume must not run: every source is attached')),
      })
      const agents = new ApiSessionAgentController(ctx, () => true)
      agents.initialize()
      const created = await agents.createSession({ cwd: '/workspace', reusable: () => false })

      await agents.disposeAgent(created.agent.id)
      expect(dispose).toHaveBeenCalledOnce()
      await agents.disposeAgent(created.agent.id)
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
