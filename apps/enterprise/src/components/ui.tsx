import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon.tsx'
import { initials } from '../lib/format.ts'

export function Button({
  children,
  variant = 'secondary',
  size = 'default',
  icon,
  loading = false,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'default' | 'small'
  icon?: IconName
  loading?: boolean
}): ReactNode {
  return (
    <button
      className={`button button-${variant} button-${size} ${className}`}
      disabled={disabled === true || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon === undefined ? null : <Icon name={icon} size={15} />}
      <span>{children}</span>
    </button>
  )
}

export function IconButton({ label, icon, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  icon: IconName
}): ReactNode {
  return (
    <button aria-label={label} className={`icon-button ${className}`} title={label} type="button" {...rest}>
      <Icon name={icon} size={16} />
    </button>
  )
}

export function Spinner({ size = 16 }: { size?: number }): ReactNode {
  return <span aria-hidden="true" className="spinner" style={{ width: size, height: size }} />
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error !== undefined ? <p className="field-error" role="alert">{error}</p> : hint !== undefined ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input className={`input ${className}`} {...rest} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea className={`input textarea ${className}`} {...rest} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return <select className={`input select ${className}`} {...rest}>{children}</select>
}

export function SearchField({ value, onChange, placeholder = '搜索' }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): ReactNode {
  return (
    <label className="search-field">
      <Icon name="search" size={15} />
      <span className="sr-only">{placeholder}</span>
      <input onChange={(event) => { onChange(event.target.value) }} placeholder={placeholder} type="search" value={value} />
    </label>
  )
}

export function Switch({ checked, onChange, label, disabled = false }: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}): ReactNode {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'is-on' : ''}`}
      disabled={disabled}
      onClick={() => { onChange(!checked) }}
      role="switch"
      type="button"
    >
      <span />
    </button>
  )
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'violet'

export function Badge({ children, tone = 'neutral', dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }): ReactNode {
  return <span className={`badge badge-${tone}`}>{dot ? <span className="badge-dot" /> : null}{children}</span>
}

export function StatusBadge({ status }: { status: string }): ReactNode {
  const config: Record<string, { label: string; tone: Tone }> = {
    active: { label: '正常', tone: 'success' },
    disabled: { label: '已停用', tone: 'neutral' },
    suspended: { label: '已暂停', tone: 'warning' },
    archived: { label: '已归档', tone: 'neutral' },
    pending: { label: '待确认', tone: 'warning' },
    paid: { label: '已支付', tone: 'success' },
    rejected: { label: '已拒绝', tone: 'danger' },
  }
  const item = config[status] ?? { label: status, tone: 'neutral' as Tone }
  return <Badge dot tone={item.tone}>{item.label}</Badge>
}

export function Avatar({ name, size = 30, presence = false }: { name: string; size?: number; presence?: boolean }): ReactNode {
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(10, size * 0.34),
  } as CSSProperties
  return <span className="avatar" data-presence={presence ? 'online' : undefined} style={style}>{initials(name)}</span>
}

export function Card({ children, className = '', padded = true }: { children: ReactNode; className?: string; padded?: boolean }): ReactNode {
  return <section className={`card ${padded ? 'card-padded' : ''} ${className}`}>{children}</section>
}

export function PageHeader({ group, title, description, actions }: {
  group?: string
  title: string
  description?: string
  actions?: ReactNode
}): ReactNode {
  return (
    <header className="page-header">
      <div className="page-heading">
        <nav aria-label="当前位置" className="breadcrumb">
          <span>{group ?? '企业管理'}</span>
          <Icon name="chevron-right" size={12} />
          <span className="breadcrumb-current">{title}</span>
        </nav>
        <h1>{title}</h1>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      {actions === undefined ? null : <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function EmptyState({ icon = 'spark', title, description, action }: {
  icon?: IconName
  title: string
  description: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function InlineNotice({ tone = 'info', title, children }: { tone?: Tone; title: string; children: ReactNode }): ReactNode {
  return (
    <div className={`inline-notice notice-${tone}`} role="note">
      <span className="notice-icon"><Icon name={tone === 'danger' ? 'alert' : tone === 'success' ? 'check' : 'shield'} size={16} /></span>
      <div><strong>{title}</strong><div>{children}</div></div>
    </div>
  )
}

export function Modal({ open, onClose, title, description, children, footer, width = 620 }: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  width?: number
}): ReactNode {
  const titleId = useId()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.classList.add('has-modal')
    window.setTimeout(() => { surfaceRef.current?.focus() }, 0)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('has-modal')
      previous?.focus()
    }
  }, [open])
  if (!open) return null
  return createPortal(
    <div className="modal-layer" role="presentation">
      <button aria-label="关闭对话框" className="modal-backdrop" onClick={onClose} type="button" />
      <div aria-labelledby={titleId} aria-modal="true" className="modal-surface" ref={surfaceRef} role="dialog" style={{ maxWidth: width }} tabIndex={-1}>
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description === undefined ? null : <p>{description}</p>}
          </div>
          <IconButton icon="close" label="关闭" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer === undefined ? null : <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export function FormGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="form-grid">{children}</div>
}

export function SectionTitle({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }): ReactNode {
  return (
    <div className="section-title">
      <div><h2>{title}</h2>{description === undefined ? null : <p>{description}</p>}</div>
      {actions === undefined ? null : <div className="section-actions">{actions}</div>}
    </div>
  )
}

export function TableFrame({ children, footer }: { children: ReactNode; footer?: ReactNode }): ReactNode {
  return <div className="table-frame">{children}{footer === undefined ? null : <div className="table-footer">{footer}</div>}</div>
}

export function PageLoader({ label = '正在加载数据…' }: { label?: string }): ReactNode {
  return <div className="page-loader" role="status"><Spinner size={20} /><span>{label}</span></div>
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div className="error-panel" role="alert">
      <span className="error-panel-icon"><Icon name="alert" size={18} /></span>
      <div><strong>加载失败</strong><p>{message}</p></div>
      {onRetry === undefined ? null : <Button icon="activity" onClick={onRetry} size="small">重试</Button>}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: {
  value: T
  onChange: (value: T) => void
  items: Array<{ value: T; label: string; count?: number }>
}): ReactNode {
  return (
    <div aria-label="视图切换" className="tabs" role="tablist">
      {items.map(item => (
        <button
          aria-selected={item.value === value}
          className={item.value === value ? 'is-active' : ''}
          key={item.value}
          onClick={() => { onChange(item.value) }}
          role="tab"
          type="button"
        >
          {item.label}
          {item.count === undefined ? null : <span>{item.count}</span>}
        </button>
      ))}
    </div>
  )
}
