import type { ReactNode } from 'react'
import { publicPath } from '../lib/public-path.ts'

export function BrandMark({ size = 34 }: { size?: number }): ReactNode {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="brand-mark"
      height={size}
      src={publicPath('/enterprise/brand-mark.png')}
      width={size}
    />
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
