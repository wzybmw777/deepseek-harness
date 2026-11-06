import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ResourceTeamPicker } from '../components/ResourceTeamPicker.tsx'
import {
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  IconButton,
  InlineNotice,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  SearchField,
  TableFrame,
  Textarea,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api, resourceFileDownloadUrl, uploadResourceFile } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { formatDate } from '../lib/format.ts'
import { useResourceTeam } from '../lib/resource-team.ts'
import type { TeamFileEntry, TeamFileListing, TeamTextFile } from '../lib/types.ts'

function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`
  const units = ['KB', 'MB', 'GB']
  let amount = value / 1024
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[index] ?? 'B'}`
}

function pathSegments(directory: string): Array<{ label: string; path: string }> {
  const result: Array<{ label: string; path: string }> = []
  const parts = directory === '' ? [] : directory.split('/')
  for (const [index, part] of parts.entries()) {
    result.push({ label: part, path: parts.slice(0, index + 1).join('/') })
  }
  return result
}

export function FilesPage(): ReactNode {
  const { notify } = useToast()
  const { can } = useAuth()
  const canWrite = can('workspace.resources.write')
  const resourceTeam = useResourceTeam()
  const teamId = resourceTeam.teamId
  const uploadRef = useRef<HTMLInputElement>(null)
  const [directory, setDirectory] = useState('')
  const [listing, setListing] = useState<TeamFileListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<TeamFileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewer, setViewer] = useState<TeamTextFile | null>(null)
  const [viewerLoading, setViewerLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async (target = directory): Promise<void> => {
    if (teamId === undefined) return
    setLoading(true)
    setError(null)
    try {
      setListing(await api.resourceFiles(target, teamId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法读取团队文件')
    } finally {
      setLoading(false)
    }
  }, [directory, teamId])

  useEffect(() => { void load(directory) }, [directory, load])

  useEffect(() => {
    setDirectory('')
    setSearch('')
    setFolderOpen(false)
    setRenameTarget(null)
    setViewerOpen(false)
    setViewer(null)
    setEditing(false)
    setDraft('')
    setSaveError(null)
  }, [teamId])

  const openFolder = (path: string): void => {
    setSearch('')
    setDirectory(path)
  }

  const changeTeam = (nextTeamId: string): void => {
    setDirectory('')
    setSearch('')
    resourceTeam.selectTeam(nextTeamId)
  }

  const upload = async (file: File): Promise<void> => {
    if (teamId === undefined) return
    setBusy(true)
    try {
      await uploadResourceFile(directory, file, teamId)
      notify(`已上传 ${file.name}`, 'success')
      await load(directory)
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '文件上传失败', 'error')
    } finally {
      setBusy(false)
      if (uploadRef.current !== null) uploadRef.current.value = ''
    }
  }

  const openViewer = async (entry: TeamFileEntry): Promise<void> => {
    if (teamId === undefined) return
    setViewerOpen(true)
    setViewerLoading(true)
    setViewer(null)
    setEditing(false)
    setSaveError(null)
    try {
      const file = await api.resourceFileContent(entry.path, teamId)
      setViewer(file)
      setDraft(file.content)
    } catch (caught) {
      setViewerOpen(false)
      notify(caught instanceof Error ? caught.message : '无法打开文件', 'error')
    } finally {
      setViewerLoading(false)
    }
  }

  const saveViewer = async (): Promise<void> => {
    if (viewer === null || teamId === undefined) return
    setBusy(true)
    setSaveError(null)
    try {
      const updated = await api.updateResourceFileContent(viewer.path, draft, teamId)
      setViewer(current => current === null ? current : { ...current, content: draft, size: updated.size, modifiedAt: updated.modifiedAt })
      setEditing(false)
      notify('文件已保存', 'success')
      await load(directory)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '文件保存失败')
    } finally {
      setBusy(false)
    }
  }

  const createFolder = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy || teamId === undefined) return
    setBusy(true)
    setFolderError(null)
    try {
      const path = directory === '' ? folderName.trim() : `${directory}/${folderName.trim()}`
      await api.createResourceDirectory(path, teamId)
      setFolderOpen(false)
      setFolderName('')
      notify('文件夹已创建', 'success')
      await load(directory)
    } catch (caught) {
      setFolderError(caught instanceof Error ? caught.message : '创建文件夹失败')
    } finally {
      setBusy(false)
    }
  }

  const rename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (renameTarget === null || busy || teamId === undefined) return
    setBusy(true)
    setRenameError(null)
    try {
      await api.renameResourceFile(renameTarget.path, renameValue.trim(), teamId)
      setRenameTarget(null)
      notify('名称已更新', 'success')
      await load(directory)
    } catch (caught) {
      setRenameError(caught instanceof Error ? caught.message : '重命名失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entry: TeamFileEntry): Promise<void> => {
    if (teamId === undefined) return
    if (!window.confirm(`确认删除「${entry.name}」？${entry.kind === 'directory' ? '目录必须为空。' : ''}`)) return
    try {
      await api.deleteResourceFile(entry.path, teamId)
      notify('已删除', 'success')
      await load(directory)
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除失败', 'error')
    }
  }

  const breadcrumb = pathSegments(directory)
  const filtered = (listing?.entries ?? []).filter((entry) => {
    const term = search.trim().toLowerCase()
    return term === '' || entry.name.toLowerCase().includes(term)
  })

  return (
    <div className="admin-page resource-page">
      <PageHeader
        description="团队共享的工作区文件，可直接被团队 AI 工作台读取和修改。"
        group="团队资源"
        title="文件"
        actions={(
          <>
            <ResourceTeamPicker onChange={changeTeam} teams={resourceTeam.teams} value={teamId ?? ''} />
            {canWrite ? (
              <>
                <Button icon="plus" loading={busy} onClick={() => uploadRef.current?.click()}>上传文件</Button>
                <Button icon="plus" onClick={() => { setFolderName(''); setFolderError(null); setFolderOpen(true) }}>新建文件夹</Button>
              </>
            ) : null}
          </>
        )}
      />
      {canWrite ? (
        <input
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) void upload(file)
          }}
          ref={uploadRef}
          type="file"
        />
      ) : null}
      <InlineNotice title="团队共享文件">
        这里的根目录就是团队 Agent 的默认工作区。隐藏文件、符号链接和系统配置目录不会显示，也不能通过资源页面访问。
      </InlineNotice>
      <Card className="table-card resource-table-card" padded={false}>
        <div className="table-toolbar resource-toolbar">
          <div className="table-toolbar-leading">
            <nav aria-label="工作区路径" className="file-breadcrumb">
              <button onClick={() => { openFolder('') }} type="button">工作区</button>
              {breadcrumb.map(part => (
                <span key={part.path}>
                  <Icon name="chevron-right" size={12} />
                  <button onClick={() => { openFolder(part.path) }} type="button">{part.label}</button>
                </span>
              ))}
            </nav>
          </div>
          <SearchField onChange={setSearch} placeholder="搜索当前目录" value={search} />
        </div>
        <TableFrame>
          {loading ? <PageLoader label="正在读取团队文件…" /> : error !== null ? (
            <ErrorPanel message={error} onRetry={() => { void load(directory) }} />
          ) : filtered.length === 0 ? (
            <EmptyState
              description={search === '' ? '上传文档、数据或代码文件，团队 Agent 会从默认工作区看到它们。' : '当前目录没有匹配的文件。'}
              icon="workspace"
              title={search === '' ? '这个目录还是空的' : '没有匹配的文件'}
              action={canWrite && search === '' ? <Button icon="plus" onClick={() => uploadRef.current?.click()} size="small" variant="primary">上传文件</Button> : undefined}
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table resource-table">
                <thead><tr><th>名称</th><th>大小</th><th>更新时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {filtered.map(entry => (
                    <tr key={entry.path}>
                      <td>
                        <button
                          className="resource-entry"
                          onClick={() => {
                            if (entry.kind === 'directory') openFolder(entry.path)
                            else if (entry.editable) void openViewer(entry)
                            else window.location.assign(resourceFileDownloadUrl(entry.path, teamId))
                          }}
                          type="button"
                        >
                          <span className="resource-entry-icon" data-kind={entry.kind}><Icon name="workspace" size={15} /></span>
                          <span className="resource-entry-copy"><strong>{entry.name}</strong><small>{entry.kind === 'directory' ? '文件夹' : '文件'}</small></span>
                        </button>
                      </td>
                      <td>{entry.kind === 'directory' ? '—' : formatBytes(entry.size)}</td>
                      <td className="cell-nowrap">{formatDate(entry.modifiedAt)}</td>
                      <td>
                        <div className="row-actions">
                          {entry.kind === 'file' && entry.editable ? <IconButton icon="eye" label="预览" onClick={() => { void openViewer(entry) }} /> : null}
                          {entry.kind === 'file' ? <IconButton icon="download" label="下载" onClick={() => { window.location.assign(resourceFileDownloadUrl(entry.path, teamId)) }} /> : null}
                          {canWrite ? <IconButton icon="edit" label="重命名" onClick={() => { setRenameTarget(entry); setRenameValue(entry.name); setRenameError(null) }} /> : null}
                          {canWrite ? <IconButton className="is-danger" icon="trash" label="删除" onClick={() => { void remove(entry) }} /> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>

      <Modal
        footer={<><Button onClick={() => { setFolderOpen(false) }}>取消</Button><Button form="new-folder-form" loading={busy} type="submit" variant="primary">创建</Button></>}
        onClose={() => { setFolderOpen(false) }}
        open={folderOpen}
        title="新建文件夹"
      >
        <form id="new-folder-form" onSubmit={(event) => { void createFolder(event) }}>
          <Field {...(folderError === null ? {} : { error: folderError })} htmlFor="new-folder-name" label="文件夹名称">
            <Input autoFocus id="new-folder-name" onChange={(event) => { setFolderName(event.target.value) }} placeholder="例如：产品资料" required value={folderName} />
          </Field>
        </form>
      </Modal>

      <Modal
        footer={<><Button onClick={() => { setRenameTarget(null) }}>取消</Button><Button form="rename-resource-form" loading={busy} type="submit" variant="primary">保存</Button></>}
        onClose={() => { setRenameTarget(null) }}
        open={renameTarget !== null}
        title="重命名"
      >
        <form id="rename-resource-form" onSubmit={(event) => { void rename(event) }}>
          <Field {...(renameError === null ? {} : { error: renameError })} htmlFor="rename-resource" label="新名称">
            <Input autoFocus id="rename-resource" onChange={(event) => { setRenameValue(event.target.value) }} required value={renameValue} />
          </Field>
        </form>
      </Modal>

      <Modal
        {...(viewer === null ? {} : { description: `${viewer.path} · ${formatBytes(viewer.size)} · ${formatDate(viewer.modifiedAt)}` })}
        footer={editing ? (
          <>
            <Button onClick={() => { setEditing(false); setDraft(viewer?.content ?? ''); setSaveError(null) }}>取消编辑</Button>
            <Button loading={busy} onClick={() => { void saveViewer() }} variant="primary">保存文件</Button>
          </>
        ) : (
          <>
            <Button onClick={() => { setViewerOpen(false) }}>关闭</Button>
            {viewer === null || !canWrite ? null : <Button icon="edit" onClick={() => { setEditing(true) }} variant="secondary">编辑</Button>}
          </>
        )}
        onClose={() => { setViewerOpen(false) }}
        open={viewerOpen}
        title={viewer?.name ?? '读取文件'}
        width={880}
      >
        {viewerLoading ? <PageLoader label="正在读取文件…" /> : viewer === null ? null : (
          <div className="resource-viewer">
            {saveError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{saveError}</div>}
            {editing ? (
              <Textarea
                aria-label="文件内容"
                className="resource-editor"
                onChange={(event) => { setDraft(event.target.value) }}
                spellCheck={false}
                value={draft}
              />
            ) : (
              <pre className="resource-preview">{viewer.content === '' ? '（空文件）' : viewer.content}</pre>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
