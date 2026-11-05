import { expect, it, vi } from 'vitest'
import { EnterpriseLifecycle } from '../src/enterprise-lifecycle.ts'

it('stops the Host before making welcome interactive', async () => {
  const events: string[] = []
  const lifecycle = new EnterpriseLifecycle({
    revoke: async () => { events.push('revoke') },
    stopHost: async () => { events.push('host') },
    clearCredential: async () => { events.push('credential') },
    beforeStop: () => { events.push('before') },
  })
  await lifecycle.logout()
  events.push('welcome')
  expect(events).toEqual(['before', 'revoke', 'host', 'credential', 'welcome'])
})

it('waits for an in-flight turn cleanup during logout', async () => {
  const pending = Promise.withResolvers<undefined>()
  const stopped = vi.fn()
  const lifecycle = new EnterpriseLifecycle({
    revoke: async () => {},
    stopHost: async () => { await pending.promise },
    clearCredential: stopped,
  })
  const logout = lifecycle.logout()
  await Promise.resolve()
  expect(stopped).not.toHaveBeenCalled()
  pending.resolve(undefined)
  await logout
  expect(stopped).toHaveBeenCalledOnce()
})

it('runs every registered cleanup once in reverse order', async () => {
  const order: string[] = []
  const lifecycle = new EnterpriseLifecycle({ revoke: async () => {}, stopHost: async () => {}, clearCredential: async () => {} })
  lifecycle.register({ stop: async () => { order.push('first') } })
  lifecycle.register({ stop: async () => { order.push('second') } })
  const dispose = lifecycle.register({ stop: async () => { order.push('removed') } })
  dispose()
  await Promise.all([lifecycle.logout(), lifecycle.logout()])
  expect(order).toEqual(['second', 'first'])
})

it('clears local credentials after a revoked refresh token', async () => {
  const clear = vi.fn(async () => {})
  const lifecycle = new EnterpriseLifecycle({ revoke: async () => {}, stopHost: async () => {}, clearCredential: clear })
  await lifecycle.handleAuthFailure(new Error('desktop_auth_revoked'))
  expect(clear).toHaveBeenCalledOnce()
})

it('keeps credentials when remote logout fails before local teardown starts', async () => {
  const stopHost = vi.fn(async () => {})
  const clear = vi.fn(async () => {})
  const lifecycle = new EnterpriseLifecycle({
    revoke: async () => { throw new Error('network down') }, stopHost, clearCredential: clear,
  })
  await expect(lifecycle.logout()).rejects.toThrow('network down')
  expect(stopHost).not.toHaveBeenCalled()
  expect(clear).not.toHaveBeenCalled()
})
