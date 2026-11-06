import type { ReactNode } from 'react'

export function BrandMark({ size = 34 }: { size?: number }): ReactNode {
  return (
    <svg aria-hidden="true" className="brand-mark" height={size} viewBox="0 0 40 40" width={size}>
      <rect fill="var(--text)" height="40" rx="10" width="40" />
      <path d="M10.5 13h7.2c5.4 0 9.8 4.4 9.8 9.8V27h-7.2c-5.4 0-9.8-4.4-9.8-9.8V13Z" fill="var(--surface)" />
      <path d="M16 19h4.8c3.4 0 6.2 2.8 6.2 6.2" fill="none" stroke="var(--text)" strokeLinecap="round" strokeWidth="2.6" />
    </svg>
  )
}

export function BrandLockup({ name }: { name: string }): ReactNode {
  return (
    <span className="brand-lockup">
      <BrandMark size={28} />
      <span className="brand-lockup-name">{name}</span>
    </span>
  )
}
