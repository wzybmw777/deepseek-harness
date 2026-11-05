import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, ApiError, type RegisterInput } from './api.ts'
import { announceEnterpriseSignOut } from './session-channel.ts'
import type { Session } from './types.ts'

interface AuthContextValue {
  session: Session | null
  loading: boolean
  error: string | null
  can: (permission: string) => boolean
  canAny: (permissions: readonly string[]) => boolean
  login: (identifier: string, password: string) => Promise<Session>
  loginWithCode: (identifier: string, code: string) => Promise<Session>
  register: (input: RegisterInput) => Promise<Session>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const current = await api.session()
      setSession(current)
      setError(null)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setSession(null)
      else setError(caught instanceof Error ? caught.message : '无法读取登录状态')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const unauthorized = (): void => { setSession(null) }
    window.addEventListener('enterprise:unauthorized', unauthorized)
    return () => { window.removeEventListener('enterprise:unauthorized', unauthorized) }
  }, [refresh])

  useEffect(() => {
    document.title = session?.settings.brandName ?? '织流企业 AI 工作台'
  }, [session?.settings.brandName])

  const login = useCallback(async (identifier: string, password: string) => {
    const current = await api.login(identifier, password)
    setSession(current)
    setError(null)
    return current
  }, [])

  const loginWithCode = useCallback(async (identifier: string, code: string) => {
    const current = await api.loginWithCode(identifier, code)
    setSession(current)
    setError(null)
    return current
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const current = await api.register(input)
    setSession(current)
    setError(null)
    return current
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setSession(null)
    announceEnterpriseSignOut()
  }, [])

  const can = useCallback((permission: string) => session?.permissions.includes(permission) ?? false, [session])
  const canAny = useCallback(
    (permissions: readonly string[]) => permissions.some(permission => session?.permissions.includes(permission) === true),
    [session],
  )
  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    error,
    can,
    canAny,
    login,
    loginWithCode,
    logout,
    register,
    refresh,
  }), [can, canAny, error, loading, login, loginWithCode, logout, refresh, register, session])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
