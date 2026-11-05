import type { ReactNode } from 'react'
import { AccountSecurityCard } from '../components/AccountSecurityCard.tsx'
import { Badge, Card, InlineNotice, PageHeader, SectionTitle } from '../components/ui.tsx'
import { useAuth } from '../lib/auth.tsx'

/** Account-security page available to every signed-in enterprise member. */
export function AccountPage(): ReactNode {
  const { session } = useAuth()

  return (
    <div className="admin-page">
      <PageHeader
        actions={<Badge tone="violet">{session?.user.roleName}</Badge>}
        description="管理当前企业账号的登录凭据和安全会话。"
        group="个人中心"
        title="账号安全"
      />
      <div className="settings-grid">
        <AccountSecurityCard className="settings-card settings-main-card" />
        <div className="settings-side">
          <Card className="settings-card">
            <SectionTitle description="适用于所有企业账号" title="密码建议" />
            <InlineNotice title="设置独立且足够长的密码">
              不要复用邮箱、其他网站或团队共享的密码。修改成功后，其他设备上的登录会话会失效。
            </InlineNotice>
          </Card>
          <Card className="settings-card">
            <SectionTitle title="忘记当前密码？" />
            <p className="field-hint">当前版本不支持自助找回密码。请联系企业管理员重置账号密码后再登录修改。</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
