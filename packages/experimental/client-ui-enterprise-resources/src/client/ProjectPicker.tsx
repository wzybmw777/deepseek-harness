/** Preview projects use the current team's sandbox; desktop keeps its native chooser. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Button, IconChevronRightOutlineRegular, IconFolderCloseRegular, IconPlusOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, type ResourcePanelProps } from './common.tsx'
import { resourcesApi, type ResourceAccess, type TeamFileListing } from './api.ts'
import css from './Product.module.css'

/** Owner directory-flow callbacks plus the enterprise locale seat. */
export type ProjectPickerProps = DirectoryFlowOwnerProps & Pick<ResourcePanelProps, 't'>

function validName(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !/[\\/\u0000-\u001f]/u.test(name) && new TextEncoder().encode(name).length <= 255
}

/** Browse a team sandbox and adopt a verified directory. @param props - owner callbacks and copy. @returns folder dialog. */
export function ProjectPicker({ open, busy: adopting, onPicked, onCancel, t }: ProjectPickerProps): ReactNode {
  const [directory, setDirectory] = useState('')
  const [listing, setListing] = useState<TeamFileListing | null>(null)
  const [access, setAccess] = useState<ResourceAccess | null>(null)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const live = useRef(false)
  const generation = useRef(0)
  const operation = useRef(false)
  const busy = adopting || working
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++ } }, [])
  useEffect(() => {
    generation.current++
    if (!open) return
    setDirectory(''); setListing(null); setAccess(null); setNewFolder(null); setError(null)
  }, [open])
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError(null)
    void Promise.all([resourcesApi.files(directory), resourcesApi.access()])
      .then(([files, permissions]) => { if (active) { setListing(files); setAccess(permissions) } })
      .catch((caught) => { if (active) setError(describeError(caught, t, 'error.load')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, directory, revision, t])
  const useDirectory = async (): Promise<void> => {
    if (operation.current || loading || listing?.directory !== directory) return
    operation.current = true; setWorking(true); setError(null)
    const current = generation.current
    try {
      const result = await resourcesApi.projectLocation(directory)
      if (live.current && current === generation.current) onPicked(result.path)
    } catch (caught) { if (live.current && current === generation.current) setError(describeError(caught, t, 'error.request')) }
    finally { operation.current = false; if (live.current) setWorking(false) }
  }
  const createFolder = async (): Promise<void> => {
    if (newFolder === null || !validName(newFolder.trim()) || operation.current || !access?.canWrite) return
    operation.current = true; setWorking(true); setError(null)
    const current = generation.current
    const path = directory === '' ? newFolder.trim() : `${directory}/${newFolder.trim()}`
    try {
      await resourcesApi.createDirectory(path)
      if (live.current && current === generation.current) { setDirectory(path); setNewFolder(null) }
    } catch (caught) { if (live.current && current === generation.current) setError(describeError(caught, t, 'error.request')) }
    finally { operation.current = false; if (live.current) setWorking(false) }
  }
  const close = (): void => { if (!adopting) { generation.current++; onCancel() } }
  const parts = directory.split('/').filter(Boolean)
  const folders = listing?.directory === directory ? listing.entries.filter(entry => entry.kind === 'directory') : []
  return <Modal open={open} onClose={close} closeLabel={t('common.close')} title={t('project.title')} description={t('project.subtitle')} className={css.projectDialog ?? ''}
    footer={<><Button disabled={adopting} onClick={close}>{t('common.cancel')}</Button><Button variant="primary" disabled={busy || loading || listing?.directory !== directory || error !== null}
      onClick={() => { void useDirectory() }}>{busy ? t('common.loading') : t('project.useFolder')}</Button></>}>
    <div className={css.projectEnvironment}><IconFolderCloseRegular size={20} /><div><span>{t('project.environment')}</span><p>{t('project.environmentHint')}</p></div></div>
    <nav className={css.breadcrumbs} aria-label={t('project.location')}>
      <button type="button" disabled={busy || directory === ''} onClick={() => { setDirectory(''); setNewFolder(null) }}>{t('project.root')}</button>
      {parts.map((part, index) => <span key={parts.slice(0, index + 1).join('/')}><IconChevronRightOutlineRegular size={12} /><button type="button" disabled={busy || index === parts.length - 1} onClick={() => { setDirectory(parts.slice(0, index + 1).join('/')); setNewFolder(null) }}>{part}</button></span>)}
    </nav>
    <div className={css.folderList} aria-busy={loading}>
      {loading ? <p role="status" className={css.quiet}>{t('common.loading')}</p> : <>
        {directory !== '' ? <button type="button" disabled={busy} onClick={() => { setDirectory(parts.slice(0, -1).join('/')); setNewFolder(null) }}>{t('project.up')}</button> : null}
        {folders.map(entry => <button key={entry.path} type="button" disabled={busy} aria-label={t('project.open', { name: entry.name })} onClick={() => { setDirectory(entry.path); setNewFolder(null) }}><IconFolderCloseRegular size={18} /><span>{entry.name}</span><IconChevronRightOutlineRegular size={14} /></button>)}
        {!error && folders.length === 0 ? <div className={css.emptyFolder}><IconFolderCloseRegular size={28} /><p>{t('project.empty')}</p><span>{t('project.emptyHint')}</span></div> : null}
      </>}
    </div>
    <div className={css.selectedFolder}><span>{t('project.selectedFolder')}</span><strong title={directory || t('project.root')}>{parts.at(-1) ?? t('project.root')}</strong></div>
    {access?.canWrite ? <div className={css.newProjectFolder}>
      {newFolder === null ? <Button variant="ghost" disabled={busy || loading} icon={<IconPlusOutlineRegular size={15} />} onClick={() => { setNewFolder('') }}>{t('project.newFolder')}</Button>
        : <form onSubmit={(event) => { event.preventDefault(); void createFolder() }}><label className={css.materials}>{t('project.folderName')}<input value={newFolder} disabled={busy} onChange={(event) => { setNewFolder(event.target.value) }} autoFocus /></label><Button type="submit" disabled={busy || !validName(newFolder.trim())}>{t('project.create')}</Button><Button variant="ghost" disabled={busy} onClick={() => { setNewFolder(null) }}>{t('common.cancel')}</Button></form>}
    </div> : null}
    {error ? <div role="alert" className={css.projectError}><p className={css.error}>{error}</p><Button size="sm" disabled={busy || loading} onClick={() => { setRevision(value => value + 1) }}>{t('common.retry')}</Button></div> : null}
  </Modal>
}
