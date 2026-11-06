/** Install the enterprise cloud catalog, metered model route, and billing projection together. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { fetchEnterpriseDesktopCatalog } from './catalog.ts'
import { EnterpriseCloudTransport, type EnterpriseBootstrapPort } from './cloud-transport.ts'
import { installEnterpriseBillingRoute } from './billing-route.ts'
import { installEnterpriseModelRoute } from './model-route.ts'

/**
 * Resolve the cloud catalog and register every local enterprise route.
 * @param ctx - Host context owning the Web server and LLM registry.
 * @param bootstrap - short-lived access grant and its refresh request.
 * @returns disposer that unregisters the routes and model provider.
 */
export async function installEnterpriseDesktopRuntime(
  ctx: Context,
  bootstrap: EnterpriseBootstrapPort,
): Promise<() => void> {
  const transport = new EnterpriseCloudTransport({ bootstrap })
  const catalog = await fetchEnterpriseDesktopCatalog(transport)
  const disposeModel = installEnterpriseModelRoute(ctx, transport, catalog, ctx.webServer.getOrigin())
  try {
    const disposeBilling = installEnterpriseBillingRoute(ctx, transport, bootstrap)
    return () => {
      disposeBilling()
      disposeModel()
    }
  } catch (error) {
    disposeModel()
    throw error
  }
}
