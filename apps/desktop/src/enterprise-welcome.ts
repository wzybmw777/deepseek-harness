/** Copy and renderer-safe contracts for enterprise desktop sign-in. */

/** Enterprise sign-in state exposed to the isolated welcome renderer. */
export interface EnterpriseWelcomeState {
  readonly serverUrl: string
  readonly email?: string
  readonly teamName?: string
  readonly signedIn: boolean
}

/** Fixed enterprise welcome operations; none returns a refresh or access token. */
export interface EnterpriseWelcomeApi {
  state(): Promise<EnterpriseWelcomeState>
  signIn(input: { readonly email: string; readonly password: string }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: 'invalid_credentials' | 'network' | 'server' }
  >
  signOut(): Promise<void>
}

export interface EnterpriseWelcomeCopy {
  readonly title: string
  readonly subtitle: string
  readonly email: string
  readonly password: string
  readonly signIn: string
  readonly entering: string
  readonly invalid: string
  readonly network: string
  readonly server: string
  readonly signOut: string
  readonly secureConnection: string
}

const en: EnterpriseWelcomeCopy = {
  title: '织流',
  subtitle: 'Your dedicated enterprise workspace',
  email: 'Enterprise email',
  password: 'Password',
  signIn: 'Sign in',
  entering: 'Entering workspace…',
  invalid: 'Email or password is incorrect.',
  network: 'Cannot reach the enterprise cloud. Check your connection and retry.',
  server: 'The enterprise cloud could not complete sign in. Retry or contact your administrator.',
  signOut: 'Sign out',
  secureConnection: 'Secured by your enterprise cloud',
}

const zh: EnterpriseWelcomeCopy = {
  title: '织流',
  subtitle: '你的专属企业工作台',
  email: '企业邮箱',
  password: '密码',
  signIn: '登录',
  entering: '正在进入工作台…',
  invalid: '企业邮箱或密码不正确。',
  network: '无法连接企业云服务，请检查网络后重试。',
  server: '企业云服务暂时无法完成登录，请重试或联系管理员。',
  signOut: '退出登录',
  secureConnection: '由企业云服务安全连接',
}

/** Resolve enterprise welcome copy from the shell locale. */
export function enterpriseWelcomeCopy(locale: string): EnterpriseWelcomeCopy {
  return locale.toLowerCase().startsWith('zh') ? zh : en
}
