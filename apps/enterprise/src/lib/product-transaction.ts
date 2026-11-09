import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Persist only operation hashes and request identities through uncertain browser outcomes. */

/**
 * Reuse the request identity for an identical unresolved operation.
 * @param scope - signed-in member and operation.
 * @param payload - transaction fields.
 * @returns identity and completion callback.
 */
export async function productTransaction(scope: string, payload: unknown): Promise<{ key: string; complete: () => void }> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const storageKey = `zhiliu.product.${scope}.${hash}`
  let key = window.sessionStorage.getItem(storageKey)
  if (!key) { key = randomUUID(); window.sessionStorage.setItem(storageKey, key) }
  return { key, complete: () => { window.sessionStorage.removeItem(storageKey) } }
}
