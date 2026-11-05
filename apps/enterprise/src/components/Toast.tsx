import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue>({ notify: () => undefined })

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [items, setItems] = useState<ToastItem[]>([])
  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random()
    setItems(current => [...current, { id, message, tone }])
    window.setTimeout(() => {
      setItems(current => current.filter(item => item.id !== id))
    }, tone === 'error' ? 5200 : 3200)
  }, [])
  const value = useMemo(() => ({ notify }), [notify])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="toast-stack">
        {items.map(item => (
          <div className={`toast toast-${item.tone}`} key={item.id} role="status">
            <span className="toast-icon">
              <Icon name={item.tone === 'success' ? 'check' : item.tone === 'error' ? 'alert' : 'spark'} size={15} />
            </span>
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
