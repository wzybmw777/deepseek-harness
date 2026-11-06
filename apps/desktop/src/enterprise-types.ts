/** Wire types shared by enterprise desktop authentication and bootstrap handling. */

/** Identity and policy payload delivered by the enterprise cloud control plane. */
export interface DesktopBootstrap {
  readonly apiVersion: 1
  readonly cloudBaseUrl: string
  readonly profileKey: string
  readonly accessExpiresAt: string
  readonly user: { readonly id: string; readonly email: string; readonly name: string; readonly roleId: string }
  readonly team: { readonly id: string; readonly name: string; readonly slug: string }
  readonly minimumClientVersion: string
  readonly policy: {
    readonly consumerAnalytics: false
    readonly crashReports: 'enterprise-support'
    readonly supportEmail: string
  }
  readonly endpoints: {
    readonly bootstrap: '/enterprise/api/desktop/bootstrap'
    readonly models: '/enterprise/api/desktop/models'
    readonly resources: '/enterprise/api/desktop/resources'
    readonly sessions: '/enterprise/api/desktop/sessions'
    readonly plugins: '/enterprise/api/desktop/plugins'
    readonly billing: '/enterprise/api/desktop/billing'
  }
}

/** Encrypted-at-rest desktop credential payload. */
export interface EnterpriseCredentialRecord {
  readonly cloudBaseUrl: string
  readonly userId: string
  readonly email: string
  readonly deviceId: string
  readonly profileKey: string
  readonly refreshToken: string
}
