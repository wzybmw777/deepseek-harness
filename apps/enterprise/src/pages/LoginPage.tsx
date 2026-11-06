import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { BrandMark } from '../components/Brand.tsx'
import { Icon } from '../components/Icon.tsx'
import { Button, IconButton } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { usePreferences } from '../lib/preferences.tsx'
import { navigate, queryValue, safeInternalPath, useLocation } from '../lib/router.tsx'
import type { PublicConfig } from '../lib/types.ts'

type AuthView = 'login' | 'register'
type LoginMode = 'password' | 'code'
type LoginStage = 'identifier' | 'password' | 'code'

function destination(next: string | undefined): string {
  const safe = safeInternalPath(next)
  return safe === undefined || safe.startsWith('/enterprise/login') ? '/enterprise/workspace' : safe
}

function finishNavigation(next: string | undefined): void {
  const target = destination(next)
  if (target.startsWith('/harness')) {
    window.location.assign('/enterprise/api/harness/launch')
    return
  }
  navigate(target, { replace: true })
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())
}

function looksLikeIdentifier(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  if (trimmed.includes('@')) return looksLikeEmail(trimmed)
  const compact = trimmed.replace(/[\s().-]/gu, '')
  return /^(?:0086|86)?1[3-9]\d{9}$/u.test(compact) || /^\+?[1-9]\d{6,14}$/u.test(compact)
}

function includeEmail(identifier: string): { email?: string } {
  return identifier.includes('@') ? {} : { email: identifier.trim() }
}

export function LoginPage(): ReactNode {
  const { session, login, loginWithCode, register } = useAuth()
  const { theme, toggleTheme } = usePreferences()
  const location = useLocation()
  const next = queryValue(location.search, 'next')
  const redirected = useRef(false)
  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const registerNameRef = useRef<HTMLInputElement>(null)
  const registerIdentifierRef = useRef<HTMLInputElement>(null)
  const registerEmailRef = useRef<HTMLInputElement>(null)
  const registerPasswordRef = useRef<HTMLInputElement>(null)
  const registerCodeRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<AuthView>('login')
  const [mode, setMode] = useState<LoginMode>('password')
  const [stage, setStage] = useState<LoginStage>('identifier')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [registerIdentifier, setRegisterIdentifier] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerCode, setRegisterCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [requestingCode, setRequestingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({
    brandName: '织流企业 AI 工作台',
    registrationEnabled: false,
    supportEmail: 'support@echoai.best',
    verificationEnabled: false,
  })

  useEffect(() => {
    void api.publicConfig().then(setPublicConfig).catch(() => {
      // The login form remains usable with deployment defaults when public branding is unavailable.
    })
  }, [])

  useEffect(() => {
    if (session === null || redirected.current) return
    redirected.current = true
    finishNavigation(next)
  }, [next, session])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => { setCooldown(value => Math.max(0, value - 1)) }, 1000)
    return () => { window.clearTimeout(timer) }
  }, [cooldown])

  const focus = (target: RefObject<HTMLInputElement | null>): void => {
    requestAnimationFrame(() => { target.current?.focus() })
  }

  const resetFeedback = (): void => {
    setMessage(null)
    setNotice(null)
  }

  const continueFromIdentifier = (): void => {
    if (!looksLikeIdentifier(identifier)) {
      setMessage('请输入有效的邮箱或手机号')
      focus(identifierRef)
      return
    }
    resetFeedback()
    if (mode === 'password') {
      setStage('password')
      focus(passwordRef)
      return
    }
    setStage('code')
    focus(codeRef)
  }

  const editIdentifier = (): void => {
    setStage('identifier')
    setPassword('')
    setCode('')
    setShowPassword(false)
    resetFeedback()
    focus(identifierRef)
  }

  const switchMode = (): void => {
    const nextMode: LoginMode = mode === 'password' ? 'code' : 'password'
    setMode(nextMode)
    resetFeedback()
    if (stage === 'identifier') {
      focus(identifierRef)
      return
    }
    setStage(nextMode === 'password' ? 'password' : 'code')
    focus(nextMode === 'password' ? passwordRef : codeRef)
  }

  const requestCode = async (purpose: 'login' | 'register'): Promise<void> => {
    const target = purpose === 'login' ? identifier : registerIdentifier
    if (!looksLikeIdentifier(target)) {
      setMessage('请输入有效的邮箱或手机号')
      focus(purpose === 'login' ? identifierRef : registerIdentifierRef)
      return
    }
    setRequestingCode(true)
    resetFeedback()
    try {
      const result = await api.requestVerificationCode(target.trim(), purpose)
      setCooldown(result.retryAfterSeconds)
      setNotice(purpose === 'login' ? '验证码已发送，10 分钟内有效' : '验证码已发送，请完成注册')
      focus(purpose === 'login' ? codeRef : registerCodeRef)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '验证码发送失败，请稍后重试')
    } finally {
      setRequestingCode(false)
    }
  }

  const finishLogin = (): void => {
    redirected.current = true
    finishNavigation(next)
  }

  const submitLogin = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    if (stage === 'identifier') {
      continueFromIdentifier()
      return
    }
    if (mode === 'password') {
      if (password === '') {
        setMessage('请输入密码')
        focus(passwordRef)
        return
      }
    } else if (code.trim() === '') {
      setMessage('请输入验证码')
      focus(codeRef)
      return
    }
    setSubmitting(true)
    resetFeedback()
    try {
      if (mode === 'password') await login(identifier.trim(), password)
      else await loginWithCode(identifier.trim(), code.trim())
      finishLogin()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const submitRegister = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    const trimmedIdentifier = registerIdentifier.trim()
    if (registerName.trim() === '') {
      setMessage('请输入姓名')
      focus(registerNameRef)
      return
    }
    if (!looksLikeIdentifier(trimmedIdentifier)) {
      setMessage('请输入有效的邮箱或手机号')
      focus(registerIdentifierRef)
      return
    }
    if (!trimmedIdentifier.includes('@') && !looksLikeEmail(registerEmail)) {
      setMessage('请输入用于账号资料的邮箱')
      focus(registerEmailRef)
      return
    }
    if (registerPassword.length < 10) {
      setMessage('密码至少需要 10 个字符')
      focus(registerPasswordRef)
      return
    }
    if (registerCode.trim() === '') {
      setMessage('请输入验证码')
      focus(registerCodeRef)
      return
    }
    setSubmitting(true)
    resetFeedback()
    try {
      await register({
        identifier: trimmedIdentifier,
        code: registerCode.trim(),
        name: registerName.trim(),
        password: registerPassword,
        ...includeEmail(trimmedIdentifier),
      })
      finishLogin()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '注册失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const openRegister = (): void => {
    setView('register')
    setStage('identifier')
    setCooldown(0)
    resetFeedback()
    focus(registerNameRef)
  }

  const backToLogin = (): void => {
    setView('login')
    setStage('identifier')
    setCooldown(0)
    resetFeedback()
    focus(identifierRef)
  }

  const codeButtonLabel = requestingCode ? '发送中…' : cooldown > 0 ? `${String(cooldown)} 秒后重发` : '获取验证码'
  const emailIdentifier = registerIdentifier.trim() !== '' && !registerIdentifier.includes('@')
  const headingTitle = view === 'register' ? `创建 ${publicConfig.brandName} 账号` : `欢迎使用 ${publicConfig.brandName}`
  const headingDescription = view === 'register' ? '验证邮箱或手机号后加入企业工作台' : '以终为始，构建企业的 AI 工作台'

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <a className="auth-back" href="https://echoai.best/">
          <Icon name="arrow-left" size={16} />
          <span>返回官网</span>
        </a>
        <IconButton
          className="auth-theme-toggle"
          icon={theme === 'dark' ? 'sun' : 'moon'}
          label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
          onClick={toggleTheme}
        />
      </header>

      <form className="auth-card" noValidate onSubmit={(event) => { void (view === 'register' ? submitRegister(event) : submitLogin(event)) }}>
        <div className="auth-heading">
          <BrandMark size={50} />
          <h1>{headingTitle}</h1>
          <p>{headingDescription}</p>
        </div>

        <div className="auth-form">
          {message === null ? null : (
            <div className="auth-error" role="alert">
              <Icon name="alert" size={15} />
              <span>{message}</span>
            </div>
          )}
          {notice === null ? null : (
            <div className="auth-notice" role="status">
              <Icon name="check" size={15} />
              <span>{notice}</span>
            </div>
          )}

          {view === 'register' ? (
            <div className="auth-register-fields">
              <div className="auth-input-shell">
                <Icon name="users" size={17} />
                <label className="sr-only" htmlFor="register-name">姓名</label>
                <input
                  autoComplete="name"
                  className="input"
                  id="register-name"
                  onChange={(event) => { setRegisterName(event.target.value); resetFeedback() }}
                  placeholder="输入姓名"
                  ref={registerNameRef}
                  value={registerName}
                />
              </div>
              <div className="auth-input-shell">
                <Icon name="users" size={17} />
                <label className="sr-only" htmlFor="register-identifier">邮箱或手机号</label>
                <input
                  autoCapitalize="none"
                  autoComplete="username"
                  className="input"
                  id="register-identifier"
                  inputMode="text"
                  onChange={(event) => { setRegisterIdentifier(event.target.value); setCooldown(0); resetFeedback() }}
                  placeholder="输入邮箱或手机号"
                  ref={registerIdentifierRef}
                  spellCheck={false}
                  value={registerIdentifier}
                />
              </div>
              {emailIdentifier ? (
                <div className="auth-input-shell">
                  <Icon name="mail" size={17} />
                  <label className="sr-only" htmlFor="register-email">账号邮箱</label>
                  <input
                    autoCapitalize="none"
                    autoComplete="email"
                    className="input"
                    id="register-email"
                    inputMode="email"
                    onChange={(event) => { setRegisterEmail(event.target.value); resetFeedback() }}
                    placeholder="输入账号邮箱"
                    ref={registerEmailRef}
                    spellCheck={false}
                    value={registerEmail}
                  />
                </div>
              ) : null}
              <div className="auth-code-row">
                <div className="auth-input-shell">
                  <Icon name="key" size={17} />
                  <label className="sr-only" htmlFor="register-code">验证码</label>
                  <input
                    autoComplete="one-time-code"
                    className="input"
                    id="register-code"
                    inputMode="numeric"
                    onChange={(event) => { setRegisterCode(event.target.value); resetFeedback() }}
                    placeholder="输入验证码"
                    ref={registerCodeRef}
                    value={registerCode}
                  />
                </div>
                <button className="auth-code-button" disabled={requestingCode || cooldown > 0} onClick={() => { void requestCode('register') }} type="button">
                  {codeButtonLabel}
                </button>
              </div>
              <div className="auth-input-shell has-action">
                <Icon name="lock" size={17} />
                <label className="sr-only" htmlFor="register-password">密码</label>
                <input
                  autoComplete="new-password"
                  className="input"
                  id="register-password"
                  onChange={(event) => { setRegisterPassword(event.target.value); resetFeedback() }}
                  placeholder="设置登录密码（至少 10 个字符）"
                  ref={registerPasswordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={registerPassword}
                />
                <button
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="auth-input-action"
                  onClick={() => { setShowPassword(current => !current) }}
                  type="button"
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={17} />
                </button>
              </div>
            </div>
          ) : stage === 'identifier' ? (
            <div className="auth-input-shell">
              <Icon name="users" size={17} />
              <label className="sr-only" htmlFor="login-identifier">邮箱或手机号</label>
              <input
                aria-invalid={message !== null}
                autoCapitalize="none"
                autoComplete="username"
                className="input"
                enterKeyHint="next"
                id="login-identifier"
                inputMode="text"
                onChange={(event) => { setIdentifier(event.target.value); setCooldown(0); resetFeedback() }}
                placeholder="输入邮箱或手机号"
                ref={identifierRef}
                spellCheck={false}
                value={identifier}
              />
            </div>
          ) : (
            <div className="auth-password-step">
              <div className="auth-account-chip">
                <Icon name="users" size={15} />
                <span>{identifier}</span>
                <button onClick={editIdentifier} type="button">修改</button>
              </div>
              {stage === 'password' ? (
                <div className="auth-input-shell has-action">
                  <Icon name="lock" size={17} />
                  <label className="sr-only" htmlFor="login-password">密码</label>
                  <input
                    aria-invalid={message !== null}
                    autoComplete="current-password"
                    className="input"
                    enterKeyHint="go"
                    id="login-password"
                    onChange={(event) => { setPassword(event.target.value); resetFeedback() }}
                    placeholder="输入登录密码"
                    ref={passwordRef}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    className="auth-input-action"
                    onClick={() => { setShowPassword(current => !current) }}
                    type="button"
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={17} />
                  </button>
                </div>
              ) : (
                <div className="auth-code-row">
                  <div className="auth-input-shell">
                    <Icon name="key" size={17} />
                    <label className="sr-only" htmlFor="login-code">验证码</label>
                    <input
                      aria-invalid={message !== null}
                      autoComplete="one-time-code"
                      className="input"
                      enterKeyHint="go"
                      id="login-code"
                      inputMode="numeric"
                      onChange={(event) => { setCode(event.target.value); resetFeedback() }}
                      placeholder="输入验证码"
                      ref={codeRef}
                      value={code}
                    />
                  </div>
                  <button className="auth-code-button" disabled={requestingCode || cooldown > 0} onClick={() => { void requestCode('login') }} type="button">
                    {codeButtonLabel}
                  </button>
                </div>
              )}
            </div>
          )}

          <Button className="auth-submit" loading={submitting} type="submit" variant="primary">
            {view === 'register' ? '注册并登录' : stage === 'identifier' ? '继续' : '登录'}
          </Button>

          {view === 'login' ? (
            <div className="auth-secondary">
              {stage === 'identifier' ? <p className="auth-method">{mode === 'password' ? '使用企业邮箱或手机号与密码登录' : '使用邮箱或手机号接收验证码登录'}</p> : (
                <button className="auth-text-action" onClick={editIdentifier} type="button">返回修改账号</button>
              )}
              {publicConfig.verificationEnabled ? (
                <button className="auth-text-action" onClick={switchMode} type="button">{mode === 'password' ? '验证码登录' : '密码登录'}</button>
              ) : null}
            </div>
          ) : null}
        </div>

        {view === 'register' ? (
          <p className="auth-register">
            已有账号？
            <button onClick={backToLogin} type="button">返回登录</button>
          </p>
        ) : publicConfig.registrationEnabled ? (
          <p className="auth-register">
            还没有账号？
            <button onClick={openRegister} type="button">注册</button>
          </p>
        ) : (
          <p className="auth-register">
            还没有账号？
            <a href={`mailto:${publicConfig.supportEmail}`}>联系管理员</a>
          </p>
        )}
      </form>
    </main>
  )
}
