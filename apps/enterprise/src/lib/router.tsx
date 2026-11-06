import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'

interface LocationState {
  pathname: string
  search: string
  hash: string
}

interface NavigateOptions {
  replace?: boolean
}

const RouterContext = createContext<LocationState>({
  pathname: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
})

function currentLocation(): LocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  }
}

export function navigate(to: string, options: NavigateOptions = {}): void {
  const target = new URL(to, window.location.origin)
  if (target.origin !== window.location.origin) {
    window.location.assign(target.href)
    return
  }
  const next = `${target.pathname}${target.search}${target.hash}`
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
  if (options.replace === true) window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
  window.dispatchEvent(new Event('enterprise:navigate'))
  window.scrollTo({ top: 0, behavior: 'instant' })
}

export function RouterProvider({ children }: { children: ReactNode }): ReactNode {
  const [location, setLocation] = useState(currentLocation)
  useEffect(() => {
    const sync = (): void => { setLocation(currentLocation()) }
    window.addEventListener('popstate', sync)
    window.addEventListener('enterprise:navigate', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('enterprise:navigate', sync)
    }
  }, [])
  const value = useMemo(() => location, [location])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useLocation(): LocationState {
  return useContext(RouterContext)
}

export function useNavigate(): (to: string, options?: NavigateOptions) => void {
  return navigate
}

export function queryValue(search: string, key: string): string | undefined {
  return new URLSearchParams(search).get(key) ?? undefined
}

export function safeInternalPath(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) return undefined
  if (!value.startsWith('/enterprise') && !value.startsWith('/harness')) return undefined
  return value
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
  replace?: boolean
  children: ReactNode
}

export function Link({ to, replace = false, onClick, children, ...rest }: LinkProps): ReactNode {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to, { replace })
  }
  return <a href={to} onClick={handleClick} {...rest}>{children}</a>
}
