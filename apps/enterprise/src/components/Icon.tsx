import type { ReactNode } from 'react'

export type IconName =
  | 'activity'
  | 'alert'
  | 'arrow-left'
  | 'arrow-right'
  | 'audit'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'channels'
  | 'close'
  | 'copy'
  | 'dashboard'
  | 'download'
  | 'edit'
  | 'external'
  | 'eye'
  | 'eye-off'
  | 'filter'
  | 'key'
  | 'lock'
  | 'mail'
  | 'menu'
  | 'models'
  | 'moon'
  | 'orders'
  | 'panel-close'
  | 'panel-open'
  | 'plans'
  | 'plus'
  | 'roles'
  | 'search'
  | 'settings'
  | 'shield'
  | 'spark'
  | 'sun'
  | 'teams'
  | 'trash'
  | 'usage'
  | 'users'
  | 'workspace'

const paths: Record<IconName, ReactNode> = {
  activity: <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />,
  alert: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.8 2.6 17.1A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.9L13.7 3.8a2 2 0 0 0-3.4 0Z" /></>,
  'arrow-left': <><path d="m15 18-6-6 6-6" /><path d="M9 12h12" /></>,
  'arrow-right': <><path d="m9 18 6-6-6-6" /><path d="M3 12h12" /></>,
  audit: <><path d="M9 4H6a2 2 0 0 0-2 2v14h16V6a2 2 0 0 0-2-2h-3" /><path d="M9 2h6v4H9z" /><path d="M8 11h8M8 15h6M8 19h4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  channels: <><path d="M5 12a7 7 0 0 1 7-7" /><path d="M19 12a7 7 0 0 1-7 7" /><circle cx="12" cy="12" r="2.5" /><path d="M5 5v4h4M19 19v-4h-4" /></>,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="4" rx="1.5" /><rect x="14" y="11" width="7" height="10" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 19h16" /></>,
  edit: <><path d="m4 16-.8 4.8L8 20l10.8-10.8a2.1 2.1 0 0 0-3-3L4 16Z" /><path d="m14 8 3 3" /></>,
  external: <><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  'eye-off': <><path d="m3 3 18 18" /><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.1 3.7" /><path d="M6.4 6.5A16 16 0 0 0 2.5 12s3.5 6 9.5 6a9.8 9.8 0 0 0 4.1-.9" /></>,
  filter: <path d="M4 5h16l-6.5 7.3V20l-3-1.5v-6.2L4 5Z" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 4h4v4" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  models: <><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>,
  moon: <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5 8.5 8.5 0 1 0 20.5 14.3Z" />,
  orders: <><path d="M6 3h12l2 4v14H4V7l2-4Z" /><path d="M4 7h16M9 11h6" /></>,
  'panel-close': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 9l-3 3 3 3" /></>,
  'panel-open': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M12 9l3 3-3 3" /></>,
  plans: <><path d="M4 7h16v12H4z" /><path d="M7 7V5h10v2M8 12h8M8 16h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  roles: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2" /><path d="M16 8h5M16 12h5M16 16h3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  shield: <><path d="M12 3 20 6v5c0 5.2-3.4 8.6-8 10-4.6-1.4-8-4.8-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  spark: <><path d="m12 3 1.5 5.2L19 10l-5.5 1.8L12 17l-1.5-5.2L5 10l5.5-1.8L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  teams: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2 20v-1a6 6 0 0 1 12 0v1M14 19.5V20M10 20v-1a6 6 0 0 1 12 0v1" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></>,
  usage: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2" /><circle cx="18" cy="9" r="2" /><path d="M17 14a5 5 0 0 1 4 4v2" /></>,
  workspace: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 14h3M8 17h6" /></>,
}

export function Icon({ name, size = 16, className, strokeWidth = 1.75 }: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  )
}
