/** Log product references through the standard command lifecycle, without granting execution rights. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

/** Product transcript command owner. */
export const name = 'enterprise-product-chat'
/** The standard command registry owns durable history and Session access checks. */
export const inject = ['commands']

/**
 * Accept only bounded public transcript data; execution and downloads keep their API checks.
 * @param input - command input.
 * @returns whether the reference is readable.
 */
export function validProductRecord(input: string): boolean {
  if (input.length > 2_100_000) return false
  let record: unknown
  try { record = JSON.parse(input) } catch { return false }
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return false
  if (!('kind' in record)) return false
  if (record.kind === 'agent') return 'jobId' in record && typeof record.jobId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/u.test(record.jobId)
  return record.kind === 'knowledge'
    && 'title' in record && typeof record.title === 'string' && record.title.length > 0 && record.title.length <= 400
    && 'input' in record && typeof record.input === 'string' && record.input.length > 0 && record.input.length <= 10_000
    && 'answer' in record && typeof record.answer === 'string' && record.answer.length <= 2_000_000
}

/**
 * Register the history carrier; its payload contains neither credentials nor private agent instructions.
 * @param ctx - tenant command registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'enterprise-task',
    description: 'Record a workbench agent or knowledge interaction',
    conversation: true,
    hidden: true,
    handler: ({ rawInput }) => validProductRecord(rawInput)
      ? { kind: 'success' }
      : { kind: 'error', text: 'Invalid workbench interaction record' },
  }), 'enterprise-product-chat: history carrier')
}
