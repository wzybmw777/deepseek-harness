import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  FormGrid,
  IconButton,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  SearchField,
  Select,
  StatusBadge,
  TableFrame,
  Tabs,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { formatCompactNumber, formatCurrency, formatDate } from '../lib/format.ts'
import { navigate } from '../lib/router.tsx'
import type { Channel, Model } from '../lib/types.ts'

type ChannelTab = 'channels' | 'models'

interface ChannelFormState {
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  priority: number
  status: 'active' | 'disabled'
}

interface ModelFormState {
  name: string
  displayName: string
  channelId: string
  inputPrice: string
  outputPrice: string
  contextWindow: number
  capabilities: string
  status: 'active' | 'disabled'
}

const EMPTY_CHANNEL: ChannelFormState = { name: '', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: '', priority: 10, status: 'active' }
const EMPTY_MODEL: ModelFormState = { name: '', displayName: '', channelId: '', inputPrice: '2.00', outputPrice: '8.00', contextWindow: 128000, capabilities: '文本\n工具调用', status: 'active' }

export function ChannelsPage({ initialTab }: { initialTab: ChannelTab }): ReactNode {
  const { can } = useAuth()
  const { notify } = useToast()
  const [channels, setChannels] = useState<Channel[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [channelModal, setChannelModal] = useState(false)
  const [modelModal, setModelModal] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [channelForm, setChannelForm] = useState<ChannelFormState>(EMPTY_CHANNEL)
  const [modelForm, setModelForm] = useState<ModelFormState>(EMPTY_MODEL)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canReadChannels = can('channels.read')
  const canWriteChannels = can('channels.write')
  const canReadModels = can('models.read')
  const canWriteModels = can('models.write')

  const load = (): void => {
    setLoading(true)
    setError(null)
    void Promise.all([
      canReadChannels ? api.channels() : Promise.resolve([]),
      canReadModels ? api.models() : Promise.resolve([]),
    ]).then(([channelList, modelList]) => {
      setChannels(channelList)
      setModels(modelList)
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取模型供给数据')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [canReadChannels, canReadModels])

  const switchTab = (tab: ChannelTab): void => {
    setSearch('')
    navigate(tab === 'channels' ? '/enterprise/admin/channels' : '/enterprise/admin/models')
  }

  const openChannelCreate = (): void => {
    setEditingChannel(null)
    setChannelForm(EMPTY_CHANNEL)
    setFormError(null)
    setChannelModal(true)
  }

  const openChannelEdit = (channel: Channel): void => {
    setEditingChannel(channel)
    setChannelForm({ name: channel.name, provider: channel.provider, baseUrl: channel.baseUrl, apiKey: '', priority: channel.priority, status: channel.status })
    setFormError(null)
    setChannelModal(true)
  }

  const openModelCreate = (): void => {
    setEditingModel(null)
    setModelForm({ ...EMPTY_MODEL, channelId: channels[0]?.id ?? '' })
    setFormError(null)
    setModelModal(true)
  }

  const openModelEdit = (model: Model): void => {
    setEditingModel(model)
    setModelForm({
      name: model.name,
      displayName: model.displayName,
      channelId: model.channelId,
      inputPrice: (model.inputPricePerMillionCents / 100).toFixed(2),
      outputPrice: (model.outputPricePerMillionCents / 100).toFixed(2),
      contextWindow: model.contextWindow,
      capabilities: model.capabilities.join('\n'),
      status: model.status,
    })
    setFormError(null)
    setModelModal(true)
  }

  const submitChannel = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      const payload = {
        name: channelForm.name,
        provider: channelForm.provider,
        baseUrl: channelForm.baseUrl,
        priority: channelForm.priority,
        status: channelForm.status,
        ...(channelForm.apiKey === '' ? {} : { apiKey: channelForm.apiKey }),
      }
      if (editingChannel === null) await api.createChannel(payload)
      else await api.updateChannel(editingChannel.id, payload)
      setChannelModal(false)
      notify(editingChannel === null ? '模型渠道已创建' : '模型渠道已更新', 'success')
      load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存模型渠道失败')
    } finally {
      setSubmitting(false)
    }
  }

  const submitModel = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      const payload = {
        name: modelForm.name,
        displayName: modelForm.displayName,
        channelId: modelForm.channelId,
        inputPricePerMillionCents: Math.round(Number(modelForm.inputPrice) * 100),
        outputPricePerMillionCents: Math.round(Number(modelForm.outputPrice) * 100),
        contextWindow: modelForm.contextWindow,
        capabilities: modelForm.capabilities.split(/\n|,/u).map(item => item.trim()).filter(Boolean),
        status: modelForm.status,
      }
      if (editingModel === null) await api.createModel(payload)
      else await api.updateModel(editingModel.id, payload)
      setModelModal(false)
      notify(editingModel === null ? '模型已加入目录' : '模型信息已更新', 'success')
      load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存模型失败')
    } finally {
      setSubmitting(false)
    }
  }

  const removeChannel = async (channel: Channel): Promise<void> => {
    if (!window.confirm(`确认删除渠道「${channel.name}」？`)) return
    try {
      await api.deleteChannel(channel.id)
      notify('渠道已删除', 'success')
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除渠道失败', 'error')
    }
  }

  const removeModel = async (model: Model): Promise<void> => {
    if (!window.confirm(`确认删除模型「${model.displayName}」？`)) return
    try {
      await api.deleteModel(model.id)
      notify('模型已删除', 'success')
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除模型失败', 'error')
    }
  }

  if (loading) return <PageLoader label="正在加载模型渠道与目录…" />
  if (error !== null) return <ErrorPanel message={error} onRetry={load} />
  const term = search.trim().toLowerCase()
  const filteredChannels = channels.filter(channel => term === '' || channel.name.toLowerCase().includes(term) || channel.provider.includes(term))
  const filteredModels = models.filter(model => term === '' || model.name.toLowerCase().includes(term) || model.displayName.toLowerCase().includes(term))

  return (
    <div className="admin-page">
      <PageHeader
        description="维护模型接入渠道、优先级与前台可选择的模型目录。"
        group="模型与供给"
        title={initialTab === 'channels' ? '渠道管理' : '模型目录'}
        actions={initialTab === 'channels'
          ? canWriteChannels ? <Button icon="plus" onClick={openChannelCreate} variant="primary">添加渠道</Button> : undefined
          : canWriteModels ? <Button icon="plus" onClick={openModelCreate} variant="primary">添加模型</Button> : undefined}
      />
      <Tabs
        items={[
          { value: 'channels', label: '接入渠道', count: channels.length },
          { value: 'models', label: '模型目录', count: models.length },
        ]}
        onChange={switchTab}
        value={initialTab}
      />

      {initialTab === 'channels' ? (
        <Card className="table-card" padded={false}>
          <div className="table-toolbar">
            <SearchField onChange={setSearch} placeholder="搜索渠道或供应商" value={search} />
            <span className="table-count">{filteredChannels.length} 个渠道</span>
          </div>
          <TableFrame>
            {filteredChannels.length === 0 ? (
              <EmptyState icon="channels" title="暂无匹配渠道" description="添加模型供应商渠道，并将模型关联到该渠道。" action={canWriteChannels ? <Button icon="plus" onClick={openChannelCreate} size="small" variant="primary">添加渠道</Button> : undefined} />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>渠道</th><th>接入地址</th><th>凭证</th><th>优先级</th><th>模型数</th><th>状态</th><th aria-label="操作" /></tr></thead>
                  <tbody>
                    {filteredChannels.map(channel => (
                      <tr key={channel.id}>
                        <td><div className="channel-cell"><span className={`channel-provider provider-${channel.provider}`}>{channel.provider.slice(0, 2).toUpperCase()}</span><div><strong>{channel.name}</strong><span>{channel.provider} · {formatDate(channel.updatedAt, false)}</span></div></div></td>
                        <td><code className="url-code">{channel.baseUrl}</code></td>
                        <td>{channel.hasCredential ? <Badge tone="success" dot>已加密</Badge> : <Badge tone="warning">未配置</Badge>}</td>
                        <td><span className="priority-cell">{channel.priority}</span></td>
                        <td><Badge tone="neutral">{channel.modelCount} 个</Badge></td>
                        <td><StatusBadge status={channel.status} /></td>
                        <td>{canWriteChannels ? <div className="row-actions"><IconButton icon="edit" label="编辑渠道" onClick={() => { openChannelEdit(channel) }} /><IconButton className="is-danger" icon="trash" label="删除渠道" onClick={() => { void removeChannel(channel) }} /></div> : <span className="muted">只读</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TableFrame>
        </Card>
      ) : (
        <Card className="table-card" padded={false}>
          <div className="table-toolbar">
            <SearchField onChange={setSearch} placeholder="搜索模型名称或标识" value={search} />
            <span className="table-count">{filteredModels.length} 个模型</span>
          </div>
          <TableFrame>
            {filteredModels.length === 0 ? (
              <EmptyState icon="models" title="暂无匹配模型" description="将模型接入渠道后加入企业模型目录。" action={canWriteModels ? <Button icon="plus" onClick={openModelCreate} size="small" variant="primary">添加模型</Button> : undefined} />
            ) : (
              <div className="table-scroll">
                <table className="data-table model-table">
                  <thead><tr><th>模型</th><th>渠道</th><th>价格 / 百万 Token</th><th>上下文</th><th>能力</th><th>状态</th><th aria-label="操作" /></tr></thead>
                  <tbody>
                    {filteredModels.map(model => (
                      <tr key={model.id}>
                        <td><div className="model-cell"><span className="model-icon"><Icon name="models" size={16} /></span><div><strong>{model.displayName}</strong><span>{model.name}</span></div></div></td>
                        <td>{model.channelName}</td>
                        <td><div className="model-price"><span>入 {formatCurrency(model.inputPricePerMillionCents)}</span><span>出 {formatCurrency(model.outputPricePerMillionCents)}</span></div></td>
                        <td><span className="cell-number">{formatCompactNumber(model.contextWindow)}</span></td>
                        <td><div className="capability-tags">{model.capabilities.slice(0, 3).map(capability => <Badge key={capability} tone="neutral">{capability}</Badge>)}</div></td>
                        <td><StatusBadge status={model.status} /></td>
                        <td>{canWriteModels ? <div className="row-actions"><IconButton icon="edit" label="编辑模型" onClick={() => { openModelEdit(model) }} /><IconButton className="is-danger" icon="trash" label="删除模型" onClick={() => { void removeModel(model) }} /></div> : <span className="muted">只读</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TableFrame>
        </Card>
      )}

      <Modal
        description="API 密钥使用 AES-256-GCM 加密存储，保存后不会在界面中回显。"
        footer={<><Button onClick={() => { setChannelModal(false) }}>取消</Button><Button form="channel-form" loading={submitting} type="submit" variant="primary">保存渠道</Button></>}
        onClose={() => { setChannelModal(false) }}
        open={channelModal}
        title={editingChannel === null ? '添加模型渠道' : '编辑模型渠道'}
      >
        <form id="channel-form" onSubmit={(event) => { void submitChannel(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <FormGrid>
            <Field htmlFor="channel-name" label="渠道名称"><Input id="channel-name" onChange={(event) => { setChannelForm(current => ({ ...current, name: event.target.value })) }} required value={channelForm.name} /></Field>
            <Field htmlFor="channel-provider" label="供应商"><Input id="channel-provider" onChange={(event) => { setChannelForm(current => ({ ...current, provider: event.target.value })) }} required value={channelForm.provider} /></Field>
            <Field className="field-span-2" htmlFor="channel-url" label="接入地址"><Input id="channel-url" onChange={(event) => { setChannelForm(current => ({ ...current, baseUrl: event.target.value })) }} required type="url" value={channelForm.baseUrl} /></Field>
            <Field className="field-span-2" hint={editingChannel?.hasCredential === true ? '留空则保留当前已加密密钥' : '可稍后配置'} htmlFor="channel-key" label="API 密钥"><Input autoComplete="off" id="channel-key" onChange={(event) => { setChannelForm(current => ({ ...current, apiKey: event.target.value })) }} placeholder="sk-..." type="password" value={channelForm.apiKey} /></Field>
            <Field htmlFor="channel-priority" label="路由优先级"><Input id="channel-priority" min={0} onChange={(event) => { setChannelForm(current => ({ ...current, priority: Number(event.target.value) })) }} required type="number" value={channelForm.priority} /></Field>
            <Field htmlFor="channel-status" label="渠道状态"><Select id="channel-status" onChange={(event) => { setChannelForm(current => ({ ...current, status: event.target.value as ChannelFormState['status'] })) }} value={channelForm.status}><option value="active">启用</option><option value="disabled">停用</option></Select></Field>
          </FormGrid>
        </form>
      </Modal>

      <Modal
        description="模型价格用于企业用量账本的成本估算；模型标识必须与上游 API 保持一致。"
        footer={<><Button onClick={() => { setModelModal(false) }}>取消</Button><Button form="model-form" loading={submitting} type="submit" variant="primary">保存模型</Button></>}
        onClose={() => { setModelModal(false) }}
        open={modelModal}
        title={editingModel === null ? '添加模型' : '编辑模型'}
        width={700}
      >
        <form id="model-form" onSubmit={(event) => { void submitModel(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <FormGrid>
            <Field htmlFor="model-display" label="展示名称"><Input id="model-display" onChange={(event) => { setModelForm(current => ({ ...current, displayName: event.target.value })) }} required value={modelForm.displayName} /></Field>
            <Field htmlFor="model-name" label="模型标识"><Input id="model-name" onChange={(event) => { setModelForm(current => ({ ...current, name: event.target.value })) }} required value={modelForm.name} /></Field>
            <Field className="field-span-2" htmlFor="model-channel" label="所属渠道">
              <Select id="model-channel" onChange={(event) => { setModelForm(current => ({ ...current, channelId: event.target.value })) }} required value={modelForm.channelId}>
                <option value="">选择渠道</option>
                {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </Select>
            </Field>
            <Field htmlFor="model-input-price" label="输入价格（元 / 百万）"><Input id="model-input-price" min={0} onChange={(event) => { setModelForm(current => ({ ...current, inputPrice: event.target.value })) }} required step="0.01" type="number" value={modelForm.inputPrice} /></Field>
            <Field htmlFor="model-output-price" label="输出价格（元 / 百万）"><Input id="model-output-price" min={0} onChange={(event) => { setModelForm(current => ({ ...current, outputPrice: event.target.value })) }} required step="0.01" type="number" value={modelForm.outputPrice} /></Field>
            <Field htmlFor="model-context" label="上下文窗口"><Input id="model-context" min={1} onChange={(event) => { setModelForm(current => ({ ...current, contextWindow: Number(event.target.value) })) }} required type="number" value={modelForm.contextWindow} /></Field>
            <Field htmlFor="model-status" label="模型状态"><Select id="model-status" onChange={(event) => { setModelForm(current => ({ ...current, status: event.target.value as ModelFormState['status'] })) }} value={modelForm.status}><option value="active">启用</option><option value="disabled">停用</option></Select></Field>
            <Field className="field-span-2" hint="每行一项，也可以用逗号分隔" htmlFor="model-capabilities" label="能力标签"><Input id="model-capabilities" onChange={(event) => { setModelForm(current => ({ ...current, capabilities: event.target.value })) }} value={modelForm.capabilities} /></Field>
          </FormGrid>
        </form>
      </Modal>
    </div>
  )
}
