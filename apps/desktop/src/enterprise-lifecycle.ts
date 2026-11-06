/** Ordered local teardown for one enterprise Desktop identity. */

/** One resource whose local state must disappear on sign-out or terminal auth failure. */
export interface EnterpriseCleanupRegistration {
  stop(): Promise<void>
}

export interface EnterpriseLifecycleOptions {
  readonly revoke: () => Promise<void>
  readonly stopHost: () => Promise<void>
  readonly clearCredential: () => Promise<void>
  readonly beforeStop?: () => void
}

/** Serializes enterprise sign-out and runs registered cleanups in reverse creation order. */
export class EnterpriseLifecycle {
  private readonly cleanups: EnterpriseCleanupRegistration[] = []
  private running: Promise<void> | undefined
  private disposed = false

  constructor(private readonly options: EnterpriseLifecycleOptions) {}

  /**
   * Register one local resource for teardown.
   * @param cleanup - resource stopped exactly once in LIFO order.
   * @returns idempotent disposal for the registration itself.
   */
  register(cleanup: EnterpriseCleanupRegistration): () => void {
    if (this.disposed) throw new Error('Enterprise lifecycle is disposed')
    this.cleanups.push(cleanup)
    let active = true
    return () => {
      if (!active) return
      active = false
      const index = this.cleanups.indexOf(cleanup)
      if (index >= 0) this.cleanups.splice(index, 1)
    }
  }

  /** Revoke the device, stop the Host, release local resources, then delete the credential. */
  logout(): Promise<void> { return this.run(true) }

  /**
   * Complete local teardown without retrying remote revocation.
   * @param _error - terminal authentication failure that required sign-out.
   */
  handleAuthFailure(_error: Error): Promise<void> { return this.run(false) }

  /** Release local resources without contacting the cloud. */
  dispose(): Promise<void> { this.disposed = true; return this.run(false) }

  private run(remote: boolean): Promise<void> {
    if (this.running !== undefined) return this.running
    const run = (async () => {
      this.options.beforeStop?.()
      if (remote) await this.options.revoke()
      await this.options.stopHost()
      const errors: unknown[] = []
      for (const cleanup of [...this.cleanups].reverse()) {
        try { await cleanup.stop() } catch (error) { errors.push(error) }
      }
      this.cleanups.length = 0
      await this.options.clearCredential()
      if (errors.length > 0) throw new AggregateError(errors, 'Enterprise local cleanup failed')
    })().finally(() => {
      if (this.running === run) this.running = undefined
    })
    this.running = run
    return run
  }
}
