import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AccountSecurityCard } from '../components/AccountSecurityCard.tsx'
import { Icon } from '../components/Icon.tsx'
import {
  Badge,
  Button,
  Card,
  Field,
  FormGrid,
  Input,
  InlineNotice,
  PageHeader,
  PageLoader,
  SectionTitle,
  Select,
  Switch,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import type { Plan, Role, Settings, Team } from '../lib/types.ts'

export function SettingsPage(): ReactNode {
  const { can, session } = useAuth()
  const { notify } = useToast()
  const canWrite = can('settings.write')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [verificationEnabled, setVerificationEnabled] = useState<boolean | null>(null)

  const load = (): void => {
    setLoading(true)
    void Promise.all([api.settings(), api.roles(), api.plans(), api.teams()]).then(([settingsValue, roleList, planList, teamList]) => {
      setSettings(settingsValue)
      setRoles(roleList)
      setPlans(planList)
      setTeams(teamList)
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  useEffect(() => {
    void api.publicConfig().then((config) => { setVerificationEnabled(config.verificationEnabled) })
      .catch(() => { setVerificationEnabled(null) })
  }, [])

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (settings === null || saving) return
    setSaving(true)
    setFormError(null)
    try {
      const updated = await api.updateSettings({
        brandName: settings.brandName,
        supportEmail: settings.supportEmail,
        sessionMaxAgeDays: settings.sessionMaxAgeDays,
        registrationEnabled: settings.registrationEnabled,
        defaultRoleId: settings.defaultRoleId,
        defaultTeamId: settings.defaultTeamId,
        defaultPlanId: settings.defaultPlanId,
      })
      setSettings(updated)
      notify('系统设置已保存', 'success')
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存设置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoader label="正在加载系统设置…" />
  if (settings === null) return null

  return (
    <div className="admin-page">
      <PageHeader
        description="配置企业品牌、默认策略、注册与安全会话。"
        group="安全与治理"
        title="系统设置"
        actions={<Badge tone={canWrite ? 'violet' : 'neutral'}>{canWrite ? '可编辑' : '只读'}</Badge>}
      />

      <div className="settings-grid">
        <Card className="settings-card settings-main-card">
          <SectionTitle description="这些设置会立即影响登录页与新建账号的默认归属。" title="企业偏好" />
          <form onSubmit={(event) => { void save(event) }}>
            {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
            <FormGrid>
              <Field className="field-span-2" htmlFor="settings-brand" label="品牌名称"><Input disabled={!canWrite} id="settings-brand" onChange={(event) => { setSettings(current => current === null ? current : { ...current, brandName: event.target.value }) }} required value={settings.brandName} /></Field>
              <Field htmlFor="settings-support" label="支持邮箱"><Input disabled={!canWrite} id="settings-support" onChange={(event) => { setSettings(current => current === null ? current : { ...current, supportEmail: event.target.value }) }} required type="email" value={settings.supportEmail} /></Field>
              <Field hint="1 到 90 天" htmlFor="settings-session" label="登录会话有效期（天）"><Input disabled={!canWrite} id="settings-session" max={90} min={1} onChange={(event) => { setSettings(current => current === null ? current : { ...current, sessionMaxAgeDays: Number(event.target.value) }) }} required type="number" value={settings.sessionMaxAgeDays} /></Field>
              <Field htmlFor="settings-role" label="新成员默认角色"><Select disabled={!canWrite} id="settings-role" onChange={(event) => { setSettings(current => current === null ? current : { ...current, defaultRoleId: event.target.value }) }} value={settings.defaultRoleId}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</Select></Field>
              <Field hint="自助注册成员会加入该团队" htmlFor="settings-team" label="自助注册默认团队"><Select disabled={!canWrite} id="settings-team" onChange={(event) => { setSettings(current => current === null ? current : { ...current, defaultTeamId: event.target.value }) }} value={settings.defaultTeamId}>{teams.filter(team => team.status === 'active').map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</Select></Field>
              <Field htmlFor="settings-plan" label="新团队默认套餐"><Select disabled={!canWrite} id="settings-plan" onChange={(event) => { setSettings(current => current === null ? current : { ...current, defaultPlanId: event.target.value }) }} value={settings.defaultPlanId}>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</Select></Field>
              <div className="field field-span-2 settings-switch-field">
                <div><label htmlFor="registration-toggle">开放自助注册</label><p>{verificationEnabled === false ? '需先配置验证码发送网关，才能开放自助注册。' : '关闭时仅管理员可以创建账号。当前版本默认关闭，以保持企业成员来源可控。'}</p></div>
                <Switch checked={settings.registrationEnabled} disabled={!canWrite || verificationEnabled === false} label="开放自助注册" onChange={(checked) => { setSettings(current => current === null ? current : { ...current, registrationEnabled: checked }) }} />
              </div>
            </FormGrid>
            {canWrite ? <div className="form-actions"><Button loading={saving} type="submit" variant="primary">保存设置</Button></div> : null}
          </form>
        </Card>

        <div className="settings-side">
          <AccountSecurityCard />

          <Card className="settings-card runtime-card">
            <SectionTitle description="部署级运行说明" title="工作台运行时" />
            <InlineNotice title="租户级 DSH 运行时">
              每个团队使用独立的 DeepSeek Harness 进程、Home、工作区、会话历史和浏览器认证密钥。企业网关只转发当前团队的请求。
            </InlineNotice>
            <dl className="runtime-facts">
              <div><dt>团队入口</dt><dd><code>{session?.runtime.harnessPath ?? '/enterprise/workspace'}</code></dd></div>
              <div><dt>隔离边界</dt><dd>{session?.runtime.tenant?.name ?? '等待分配团队'} · 独立进程与 Home</dd></div>
              <div><dt>访问控制</dt><dd>企业会话 + 团队归属校验 + 网关代理</dd></div>
              <div><dt>会话 Cookie</dt><dd>仅企业 Cookie 到达浏览器；DSH Cookie 网关注入</dd></div>
              <div><dt>审计策略</dt><dd>管理写操作与工作台访问全部记录</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}
