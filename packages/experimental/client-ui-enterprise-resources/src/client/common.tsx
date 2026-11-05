/** Shared layout, states, and controls for the three enterprise resource pages. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  IconCheckCircleOutlineRegular,
  IconCloseOutlineRegular,
  IconLoadingOutlineRegular,
  IconSearchOutlineRegular,
  IconWarningOutlineRegular,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ResourceApiError, resourcesApi } from './api.ts'
import { NS, type EnterpriseResourcesKey } from './locales.ts'
import css from './Resources.module.css'

/** Props every main-panel page receives from the slot renderer. */
export type ResourcePanelProps = PropsRuntime<'main'> & PropsLocale<typeof NS>

/** Resolve whether the signed-in member may maintain shared team resources. */
export function useResourceWriteAccess(): boolean {
  const [canWrite, setCanWrite] = useState(false)
  useEffect(() => {
    let active = true
    void resourcesApi.access().then((access) => {
      if (active) setCanWrite(access.canWrite)
    }).catch(() => {
      if (active) setCanWrite(false)
    })
    return () => { active = false }
  }, [])
  return canWrite
}

/** One success or failure message shown inside the resource panel. */
export interface ResourceNotice {
  readonly tone: 'success' | 'error'
  readonly message: string
}

/** Notice state and setters shared by the resource pages. */
export interface ResourceNoticeControls {
  readonly notice: ResourceNotice | null
  readonly showSuccess: (message: string) => void
  readonly showError: (message: string) => void
  readonly dismiss: () => void
}

/** Own a page notice; successful mutations expire while failures remain until dismissed. */
export function useResourceNotice(): ResourceNoticeControls {
  const [notice, setNotice] = useState<ResourceNotice | null>(null)
  useEffect(() => {
    if (notice === null || notice.tone === 'error') return
    const timer = window.setTimeout(() => { setNotice(null) }, 5_000)
    return () => { window.clearTimeout(timer) }
  }, [notice])
  const showSuccess = useCallback((message: string) => { setNotice({ tone: 'success', message }) }, [])
  const showError = useCallback((message: string) => { setNotice({ tone: 'error', message }) }, [])
  const dismiss = useCallback(() => { setNotice(null) }, [])
  return { notice, showSuccess, showError, dismiss }
}

/** Translate a caught failure without exposing raw browser transport wording. */
export function describeError(
  caught: unknown,
  t: ResourcePanelProps['t'],
  fallback: EnterpriseResourcesKey,
): string {
  if (caught instanceof ResourceApiError) {
    if (caught.code === 'invalid_response' || caught.message === caught.code) return t(fallback)
    return caught.message
  }
  if (caught instanceof TypeError) return t('error.network')
  return t(fallback)
}

/** Page shell with a stable heading and a single scroll region. */
export function PageFrame({ title, description, actions, children }: {
  readonly title: string
  readonly description: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}): ReactNode {
  return (
    <section className={css.page}>
      <div className={css.scroll}>
        <div className={css.content}>
          <header className={css.header}>
            <div className={css.heading}>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            {actions === undefined ? null : <div className={css.headerActions}>{actions}</div>}
          </header>
          {children}
        </div>
      </div>
    </section>
  )
}

/** Primary page action with a leading icon. */
export function PageAction({ label, icon, onClick, disabled = false }: {
  readonly label: string
  readonly icon: ReactNode
  readonly onClick: () => void
  readonly disabled?: boolean
}): ReactNode {
  return (
    <Button className={css.primaryAction} disabled={disabled} icon={icon} onClick={onClick} variant="primary">
      {label}
    </Button>
  )
}

/** Search box that owns only text entry; callers own result filtering. */
export function SearchBox({ value, onChange, placeholder, label }: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
  readonly label: string
}): ReactNode {
  return (
    <label className={css.searchBox}>
      <span className={css.searchIcon} aria-hidden="true"><IconSearchOutlineRegular size={16} /></span>
      <input
        aria-label={label}
        onChange={(event) => { onChange(event.target.value) }}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  )
}

/** Inline result row for a resource mutation, rendered inside the resource panel. */
export function PanelNotice({ notice, onDismiss, dismissLabel }: {
  readonly notice: ResourceNotice | null
  readonly onDismiss: () => void
  readonly dismissLabel: string
}): ReactNode {
  if (notice === null) return null
  return (
    <div
      className={css.notice}
      data-resource-feedback=""
      data-tone={notice.tone}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      <span className={css.noticeIcon} aria-hidden="true">
        {notice.tone === 'error'
          ? <IconWarningOutlineRegular size={16} />
          : <IconCheckCircleOutlineRegular size={16} />}
      </span>
      <span className={css.noticeMessage}>{notice.message}</span>
      <button type="button" aria-label={dismissLabel} onClick={onDismiss}>
        <IconCloseOutlineRegular size={14} />
      </button>
    </div>
  )
}

/** Dialog-level failure summary shown above form fields. */
export function FormError({ message }: { readonly message: string }): ReactNode {
  return (
    <div className={css.formError} role="alert">
      <IconWarningOutlineRegular size={15} />
      <span>{message}</span>
    </div>
  )
}

/** Loading state with the resource page's spinner. */
export function LoadingState({ label }: { readonly label: string }): ReactNode {
  return (
    <div className={css.loading} role="status">
      <span className={css.spinner} aria-hidden="true"><IconLoadingOutlineRegular size={20} /></span>
      <span>{label}</span>
    </div>
  )
}

/** Failed-load state with one retry action. */
export function ErrorState({ message, retryLabel, onRetry }: {
  readonly message: string
  readonly retryLabel: string
  readonly onRetry: () => void
}): ReactNode {
  return (
    <div className={css.errorState} role="alert">
      <p>{message}</p>
      <Button onClick={onRetry} size="sm" variant="outline">{retryLabel}</Button>
    </div>
  )
}

/** Empty result state with an optional primary action. */
export function EmptyState({ icon, title, description, action }: {
  readonly icon: ReactNode
  readonly title: string
  readonly description: string
  readonly action?: ReactNode
}): ReactNode {
  return (
    <div className={css.emptyState}>
      <span className={css.emptyIcon} aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

/** Small square action used by row and card controls. */
export function IconAction({ label, icon, onClick, danger = false, disabled = false }: {
  readonly label: string
  readonly icon: ReactNode
  readonly onClick: () => void
  readonly danger?: boolean
  readonly disabled?: boolean
}): ReactNode {
  return (
    <button
      aria-label={label}
      className={css.iconAction}
      data-danger={danger || undefined}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  )
}

/** Labeled form field used by resource dialogs. */
export function DialogField({ id, label, hint, error, children }: {
  readonly id: string
  readonly label: string
  readonly hint?: string | undefined
  readonly error?: string | null | undefined
  readonly children: ReactNode
}): ReactNode {
  const help = error === undefined || error === null
    ? hint === undefined ? null : <p>{hint}</p>
    : (
      <p className={css.fieldError} id={`${id}-error`} role="alert">
        <IconWarningOutlineRegular size={14} />
        <span>{error}</span>
      </p>
    )
  return (
    <div className={css.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help}
    </div>
  )
}

/** Shared modal chrome for resource create, edit, and preview flows. */
export function ResourceDialog({ open, title, description, closeLabel, footer, wide = false, onClose, children }: {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly closeLabel: string
  readonly footer: ReactNode
  readonly wide?: boolean
  readonly onClose: () => void
  readonly children: ReactNode
}): ReactNode {
  return (
    <Modal
      closeLabel={closeLabel}
      footer={footer}
      onClose={onClose}
      open={open}
      title={title}
      {...(wide ? { className: css.dialogWide ?? '' } : { className: css.dialog ?? '' })}
      {...(description === undefined ? {} : { description })}
    >
      {children}
    </Modal>
  )
}

/** Dialog action row with a quiet cancel and emphasized submit action. */
export function DialogActions({ cancelLabel, submitLabel, submitting = false, submitDisabled = false, form, onCancel }: {
  readonly cancelLabel: string
  readonly submitLabel: string
  readonly submitting?: boolean
  readonly submitDisabled?: boolean
  readonly form: string
  readonly onCancel: () => void
}): ReactNode {
  return (
    <>
      <Button onClick={onCancel}>{cancelLabel}</Button>
      <Button disabled={submitting || submitDisabled} form={form} type="submit" variant="primary">{submitLabel}</Button>
    </>
  )
}
