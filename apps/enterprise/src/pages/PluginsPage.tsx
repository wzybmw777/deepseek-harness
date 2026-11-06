import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  Input,
  InlineNotice,
  Modal,
  PageHeader,
  PageLoader,
  Select,
  Switch,
  Tabs,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import type { PluginView, PluginsView } from '../lib/types.ts'

interface PluginSectionProps {
  readonly summary: string
  readonly plugins: readonly PluginView[]
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly busyId: string | null
  readonly onToggle: (plugin: PluginView) => void
  readonly onRemove?: (plugin: PluginView) => void
}

function PluginSection({ summary, plugins, emptyTitle, emptyDescription, busyId, onToggle, onRemove }: PluginSectionProps): ReactNode {
  return (
    <Card className="plugin-section" padded={false}>
      <div className="plugin-section-head">
        <span>{summary}</span>
      </div>
      {plugins.length === 0 ? (
        <EmptyState icon="models" title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="plugin-list">
          {plugins.map(plugin => (
            <div className="plugin-row" key={plugin.id}>
              <span className="plugin-icon"><Icon name={plugin.scope === 'builtin' ? 'spark' : 'models'} size={17} /></span>
              <div className="plugin-copy">
                <div className="plugin-title">
                  <strong>{plugin.label}</strong>
                  {plugin.version === undefined ? null : <Badge tone="neutral">v{plugin.version}</Badge>}
                </div>
                {plugin.description === '' ? null : <p>{plugin.description}</p>}
                <code>{plugin.packageName}</code>
              </div>
              <div className="plugin-actions">
                {plugin.manageable ? (
                  <Switch
                    checked={plugin.enabled}
                    disabled={busyId === plugin.id}
                    label={`${plugin.enabled ? '停用' : '启用'} ${plugin.label}`}
                    onChange={() => { onToggle(plugin) }}
                  />
                ) : (
                  <Badge tone="neutral">所有者管理</Badge>
                )}
                {onRemove !== undefined && plugin.manageable ? (
                  <Button disabled={busyId === plugin.id} onClick={() => { onRemove(plugin) }} size="small" variant="ghost">移除</Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function PluginsPage(): ReactNode {
  const { can, session } = useAuth()
  const { notify } = useToast()
  const canAddBuiltin = session?.user.roleId === 'role-owner' && can('plugins.builtin.write')
  const canAddEnterprise = can('plugins.enterprise.write')
  const [view, setView] = useState<PluginsView>({ builtins: [], enterprise: [] })
  const [activeTab, setActiveTab] = useState<PluginView['scope']>(() => canAddBuiltin || !canAddEnterprise ? 'builtin' : 'enterprise')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [builtinModalOpen, setBuiltinModalOpen] = useState(false)
  const [builtinPackage, setBuiltinPackage] = useState('')
  const [builtinError, setBuiltinError] = useState<string | null>(null)
  const [enterpriseModalOpen, setEnterpriseModalOpen] = useState(false)
  const [spec, setSpec] = useState('')
  const [enterpriseError, setEnterpriseError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const availableBuiltins = view.builtins.filter(plugin => !plugin.enabled)
  const selectedBuiltin = availableBuiltins.find(plugin => plugin.packageName === builtinPackage)

  const load = (): void => {
    setLoading(true)
    setError(null)
    void api.plugins().then(setView).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取插件策略')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  const toggled = async (plugin: PluginView): Promise<void> => {
    if (busyId !== null) return
    setBusyId(plugin.id)
    try {
      setView(await api.setPluginEnabled(plugin.id, !plugin.enabled))
      notify(plugin.enabled ? '插件已停用' : '插件已启用', 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '更新插件失败', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (plugin: PluginView): Promise<void> => {
    if (busyId !== null || !window.confirm(`确认移除「${plugin.label}」？`)) return
    setBusyId(plugin.id)
    try {
      setView(await api.removePlugin(plugin.id))
      notify('企业插件已移除', 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '移除插件失败', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const openBuiltinModal = (): void => {
    setBuiltinPackage(availableBuiltins[0]?.packageName ?? '')
    setBuiltinError(null)
    setBuiltinModalOpen(true)
  }

  const openEnterpriseModal = (): void => {
    setSpec('')
    setEnterpriseError(null)
    setEnterpriseModalOpen(true)
  }

  const submitBuiltin = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || builtinPackage === '') return
    setSubmitting(true)
    setBuiltinError(null)
    try {
      setView(await api.addBuiltinPlugin(builtinPackage))
      setBuiltinModalOpen(false)
      setBuiltinPackage('')
      notify('内置插件已添加并启用', 'success')
    } catch (caught) {
      setBuiltinError(caught instanceof Error ? caught.message : '添加内置插件失败')
    } finally {
      setSubmitting(false)
    }
  }

  const submitEnterprise = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setEnterpriseError(null)
    try {
      setView(await api.addPlugin(spec))
      setEnterpriseModalOpen(false)
      setSpec('')
      notify('企业插件已添加并启用', 'success')
    } catch (caught) {
      setEnterpriseError(caught instanceof Error ? caught.message : '添加插件失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageLoader label="正在加载插件策略…" />
  if (error !== null) return <ErrorPanel message={error} onRetry={load} />

  return (
    <div className="admin-page">
      <PageHeader
        description="所有者可添加全部插件，管理员只能添加企业插件。"
        group="组织与权限"
        title="插件管理"
        actions={activeTab === 'builtin'
          ? canAddBuiltin
            ? <Button icon="plus" onClick={openBuiltinModal} variant="primary">添加内置插件</Button>
            : undefined
          : canAddEnterprise
            ? <Button icon="plus" onClick={openEnterpriseModal} variant="primary">添加企业插件</Button>
            : undefined}
      />
      <Tabs
        items={[
          { value: 'builtin', label: '内置插件', count: view.builtins.length },
          { value: 'enterprise', label: '企业插件', count: view.enterprise.length },
        ]}
        onChange={setActiveTab}
        value={activeTab}
      />
      {activeTab === 'builtin' ? (
        <PluginSection
          busyId={busyId}
          emptyDescription="安装包中没有可配置的内置插件。"
          emptyTitle="暂无内置插件"
          onToggle={(plugin) => { void toggled(plugin) }}
          plugins={view.builtins}
          summary={`全员共享 · ${view.builtins.filter(plugin => plugin.enabled).length} / ${view.builtins.length} 已启用`}
        />
      ) : (
        <PluginSection
          busyId={busyId}
          emptyDescription="管理员可以添加企业专属插件，仅在本企业工作台生效。"
          emptyTitle="暂无企业插件"
          onRemove={(plugin) => { void remove(plugin) }}
          onToggle={(plugin) => { void toggled(plugin) }}
          plugins={view.enterprise}
          summary={`仅本企业 · ${view.enterprise.filter(plugin => plugin.enabled).length} 个已启用`}
        />
      )}
      <Modal
        description="选择随安装包提供的内置插件，添加后自动应用到所有团队。"
        footer={<><Button onClick={() => { setBuiltinModalOpen(false) }}>取消</Button><Button disabled={builtinPackage === ''} form="builtin-plugin-form" loading={submitting} type="submit" variant="primary">添加并启用</Button></>}
        onClose={() => { setBuiltinModalOpen(false) }}
        open={builtinModalOpen}
        title="添加内置插件"
      >
        <form id="builtin-plugin-form" onSubmit={(event) => { void submitBuiltin(event) }}>
          {builtinError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{builtinError}</div>}
          {availableBuiltins.length === 0 ? (
            <InlineNotice tone="success" title="全部已添加">所有内置插件均已添加并启用，无需重复添加。</InlineNotice>
          ) : (
            <Field hint={selectedBuiltin?.description ?? '请选择一个尚未启用的内置插件。'} htmlFor="builtin-plugin-package" label="内置插件">
              <Select
                autoFocus
                id="builtin-plugin-package"
                onChange={(event) => { setBuiltinPackage(event.target.value) }}
                required
                value={builtinPackage}
              >
                {availableBuiltins.map(plugin => <option key={plugin.id} value={plugin.packageName}>{plugin.label}</option>)}
              </Select>
            </Field>
          )}
        </form>
      </Modal>
      <Modal
        description="输入 npm 包名或包名@版本，安装后自动应用到所有团队。"
        footer={<><Button onClick={() => { setEnterpriseModalOpen(false) }}>取消</Button><Button form="plugin-form" loading={submitting} type="submit" variant="primary">安装并启用</Button></>}
        onClose={() => { setEnterpriseModalOpen(false) }}
        open={enterpriseModalOpen}
        title="添加企业插件"
      >
        <form id="plugin-form" onSubmit={(event) => { void submitEnterprise(event) }}>
          {enterpriseError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{enterpriseError}</div>}
          <Field hint="例如 @scope/plugin 或 @scope/plugin@1.2.3" htmlFor="plugin-spec" label="插件包">
            <Input autoFocus id="plugin-spec" onChange={(event) => { setSpec(event.target.value) }} placeholder="@scope/dsh-plugin" required value={spec} />
          </Field>
        </form>
      </Modal>
    </div>
  )
}
