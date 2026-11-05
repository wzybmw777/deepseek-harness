import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type Theme = 'light' | 'dark'
type Density = 'comfortable' | 'compact'

interface PreferencesContextValue {
  theme: Theme
  density: Density
  sidebarCollapsed: boolean
  setTheme: (theme: Theme) => void
  setDensity: (density: Density) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleTheme: () => void
  toggleDensity: () => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

function stored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const value = window.localStorage.getItem(key)
  return value !== null && allowed.includes(value as T) ? value as T : fallback
}

export function PreferencesProvider({ children }: { children: ReactNode }): ReactNode {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const [theme, setThemeState] = useState<Theme>(() => stored('enterprise.theme', systemDark ? 'dark' : 'light', ['light', 'dark']))
  const [density, setDensityState] = useState<Density>(() => stored('enterprise.density', 'comfortable', ['comfortable', 'compact']))
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => window.localStorage.getItem('enterprise.sidebar') === 'collapsed')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem('enterprise.theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.density = density
    window.localStorage.setItem('enterprise.density', density)
  }, [density])

  const setSidebarCollapsed = (collapsed: boolean): void => {
    setSidebarCollapsedState(collapsed)
    window.localStorage.setItem('enterprise.sidebar', collapsed ? 'collapsed' : 'expanded')
  }

  const value = useMemo<PreferencesContextValue>(() => ({
    theme,
    density,
    sidebarCollapsed,
    setTheme: setThemeState,
    setDensity: setDensityState,
    setSidebarCollapsed,
    toggleTheme: () => { setThemeState(current => current === 'light' ? 'dark' : 'light') },
    toggleDensity: () => { setDensityState(current => current === 'compact' ? 'comfortable' : 'compact') },
  }), [density, sidebarCollapsed, theme])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext)
  if (value === null) throw new Error('usePreferences must be used inside PreferencesProvider')
  return value
}
