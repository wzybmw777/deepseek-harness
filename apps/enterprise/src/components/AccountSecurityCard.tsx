import { useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'
import { Button, Card, Field, Input, SectionTitle } from './ui.tsx'
import { useToast } from './Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'

/** Password-change form for the signed-in enterprise account. */
export function AccountSecurityCard({ className = 'settings-card' }: { className?: string }): ReactNode {
  const { session } = useAuth()
  const { notify } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changePassword = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (saving) return
    setError(null)
    if (newPassword.length < 10) {
      setError('新密码至少需要 10 个字符')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setSaving(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      notify('登录密码已更新，其他设备将需要重新登录', 'success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '修改密码失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className={className}>
      <SectionTitle description="修改当前账号的登录密码" title="账户安全" />
      <div className="account-summary">
        <span className="account-avatar">{session?.user.name.slice(0, 1)}</span>
        <div><strong>{session?.user.name}</strong><span>{session?.user.email}</span><small>{session?.user.roleName}</small></div>
      </div>
      <form onSubmit={(event) => { void changePassword(event) }}>
        {error === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{error}</div>}
        <Field htmlFor="account-current-password" label="当前密码"><Input autoComplete="current-password" id="account-current-password" onChange={(event) => { setCurrentPassword(event.target.value); setError(null) }} required type="password" value={currentPassword} /></Field>
        <Field hint="至少 10 个字符" htmlFor="account-new-password" label="新密码"><Input autoComplete="new-password" id="account-new-password" minLength={10} onChange={(event) => { setNewPassword(event.target.value); setError(null) }} required type="password" value={newPassword} /></Field>
        <Field htmlFor="account-confirm-password" label="确认新密码"><Input autoComplete="new-password" id="account-confirm-password" minLength={10} onChange={(event) => { setConfirmPassword(event.target.value); setError(null) }} required type="password" value={confirmPassword} /></Field>
        <Button loading={saving} type="submit" variant="secondary">更新密码</Button>
      </form>
    </Card>
  )
}
