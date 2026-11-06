/** Enterprise sign-in surface with no provider-key or token state. */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { WelcomeApi } from '../welcome-api.ts'

/**
 * Render the fixed enterprise email/password entry.
 * @param props.api - isolated preload API with fixed enterprise operations.
 * @returns enterprise sign-in page.
 */
export function EnterpriseWelcome({ api }: { api: WelcomeApi }) {
  const copy = api.enterpriseCopy
  const enterprise = api.enterprise
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const mounted = useRef(true)
  const emailInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = copy.title
    if (enterprise !== undefined) {
      void enterprise.state().then((state) => {
        if (mounted.current) setServerUrl(new URL(state.serverUrl).host)
      }).catch(() => undefined)
    }
    emailInput.current?.focus()
    return () => { mounted.current = false }
  }, [api.id, copy.title, enterprise])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || enterprise === undefined) return
    setBusy(true)
    setError('')
    try {
      const result = await enterprise.signIn({ email: email.trim(), password })
      if (!mounted.current || result.ok) return
      setError(result.code === 'invalid_credentials' ? copy.invalid
        : result.code === 'network' ? copy.network : copy.server)
    } catch {
      if (mounted.current) setError(copy.server)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome enterprise-welcome" aria-labelledby="enterprise-heading">
      <div className="enterprise-brand" aria-hidden="true">织流</div>
      <section className="enterprise-panel">
        <header className="enterprise-heading">
          <p className="enterprise-eyebrow">ENTERPRISE</p>
          <h1 id="enterprise-heading">{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </header>
        <form className="enterprise-form" noValidate onSubmit={(event) => { void submit(event) }}>
          <label>
            <span>{copy.email}</span>
            <input ref={emailInput} type="email" autoComplete="username" spellCheck={false}
              value={email} disabled={busy} onChange={(event) => { setEmail(event.target.value); setError('') }} />
          </label>
          <label>
            <span>{copy.password}</span>
            <input type="password" autoComplete="current-password"
              value={password} disabled={busy} onChange={(event) => { setPassword(event.target.value); setError('') }} />
          </label>
          <p className="enterprise-error" role="alert" hidden={error === ''}>{error}</p>
          <button className="primary" type="submit" disabled={busy || email.trim() === '' || password === ''}>
            {busy ? copy.entering : copy.signIn}
          </button>
        </form>
        <footer className="enterprise-footer">
          <span>{copy.secureConnection}</span>
          {serverUrl !== '' && <code>{serverUrl}</code>}
        </footer>
      </section>
    </main>
  </>
}
