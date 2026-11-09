/** Shared restrained navigation for consumer creation and knowledge pages. */
import type { ReactNode } from 'react'
import { BrandLockup } from './Brand.tsx'
import { IconButton } from './ui.tsx'
import { useAuth } from '../lib/auth.tsx'
import { usePreferences } from '../lib/preferences.tsx'
import { Link } from '../lib/router.tsx'
import { productCopy as c } from '../lib/product-copy.ts'
import styles from '../pages/Product.module.css'

/** @param props - consumer page content and current section. @returns consistent consumer shell. */
export function ProductLayout({ children, section = 'market' }: { children: ReactNode; section?: 'market' | 'knowledge' }): ReactNode {
  const { can } = useAuth()
  const preferences = usePreferences()
  return <div className={styles.consumer}>
    <header className={styles.header}>
      <Link className={styles.brand} to="/enterprise/workspace"><BrandLockup name={c.brand} /></Link>
      <nav className={styles.headerLinks} aria-label={section === 'market' ? c.market : c.knowledge}>
        <Link to="/enterprise/workspace">{c.back}</Link>
        {section === 'knowledge' ? <Link to="/enterprise/agents">{c.market}</Link> : null}
        <Link to="/enterprise/resources/knowledge">{c.knowledge}</Link>
        {can('settings.write') ? <Link to="/enterprise/admin/agents">{c.manage}</Link> : null}
        <IconButton icon={preferences.theme === 'dark' ? 'sun' : 'moon'} label={preferences.theme === 'dark' ? c.light : c.dark} onClick={preferences.toggleTheme} />
      </nav>
    </header>
    <main className={styles.content}>{children}</main>
  </div>
}
