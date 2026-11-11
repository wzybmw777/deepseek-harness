import type { IconName } from '../components/Icon.tsx'

export interface AdminNavItem {
  path: string
  label: string
  shortLabel: string
  icon: IconName
  permission: string | readonly string[]
}

export interface AdminNavGroup {
  key: string
  label: string
  items: AdminNavItem[]
}

export const ADMIN_NAVIGATION: AdminNavGroup[] = [
  {
    key: 'account',
    label: '账户与服务',
    items: [
      { path: '/enterprise/billing', label: '套餐与额度', shortLabel: '额度', icon: 'plans', permission: 'workspace.use' },
    ],
  },
  {
    key: 'resources',
    label: '团队资源',
    items: [
      { path: '/enterprise/resources/files', label: '文件', shortLabel: '文件', icon: 'workspace', permission: 'workspace.use' },
      { path: '/enterprise/resources/knowledge', label: '知识库', shortLabel: '知识', icon: 'models', permission: 'workspace.use' },
      { path: '/enterprise/feilian', label: '飞链知识库', shortLabel: '飞链', icon: 'models', permission: 'workspace.use' },
      { path: '/enterprise/resources/skills', label: '技能', shortLabel: '技能', icon: 'spark', permission: 'workspace.resources.write' },
    ],
  },
  {
    key: 'overview',
    label: '运营监控',
    items: [
      { path: '/enterprise/admin', label: '运行总览', shortLabel: '总览', icon: 'dashboard', permission: 'dashboard.read' },
    ],
  },
  {
    key: 'organization',
    label: '组织与权限',
    items: [
      { path: '/enterprise/admin/users', label: '用户管理', shortLabel: '用户', icon: 'users', permission: 'users.read' },
      { path: '/enterprise/admin/teams', label: '团队管理', shortLabel: '团队', icon: 'teams', permission: 'teams.read' },
      { path: '/enterprise/admin/roles', label: '角色权限', shortLabel: '权限', icon: 'roles', permission: 'roles.read' },
      { path: '/enterprise/admin/plugins', label: '插件管理', shortLabel: '插件', icon: 'models', permission: ['plugins.builtin.write', 'plugins.enterprise.write'] },
    ],
  },
  {
    key: 'commerce',
    label: '套餐与计费',
    items: [
      { path: '/enterprise/admin/plans', label: '套餐管理', shortLabel: '套餐', icon: 'plans', permission: 'plans.read' },
      { path: '/enterprise/admin/orders', label: '订单管理', shortLabel: '订单', icon: 'orders', permission: 'orders.read' },
    ],
  },
  {
    key: 'models',
    label: '模型与供给',
    items: [
      { path: '/enterprise/admin/channels', label: '渠道管理', shortLabel: '渠道', icon: 'channels', permission: 'channels.read' },
      { path: '/enterprise/admin/models', label: '模型目录', shortLabel: '模型', icon: 'models', permission: 'models.read' },
      { path: '/enterprise/admin/usage', label: '用量统计', shortLabel: '用量', icon: 'usage', permission: 'usage.read' },
    ],
  },
  {
    key: 'governance',
    label: '安全与治理',
    items: [
      { path: '/enterprise/admin/audit', label: '审计日志', shortLabel: '审计', icon: 'audit', permission: 'audit.read' },
      { path: '/enterprise/admin/settings', label: '系统设置', shortLabel: '设置', icon: 'settings', permission: 'settings.read' },
      { path: '/enterprise/admin/agents', label: '智能体管理', shortLabel: '智能体', icon: 'spark', permission: 'settings.write' },
    ],
  },
]

export function findNavigation(pathname: string): { group: AdminNavGroup; item: AdminNavItem } | undefined {
  for (const group of ADMIN_NAVIGATION) {
    const item = group.items.find(candidate => candidate.path === pathname)
    if (item !== undefined) return { group, item }
  }
  return undefined
}

export const PERMISSION_LABELS: Record<string, string> = {
  'workspace.use': '进入 AI 工作台',
  'workspace.resources.write': '维护团队共享资源',
  'billing.purchase': '购买与续费套餐',
  'plugins.builtin.write': '控制内置插件',
  'plugins.enterprise.write': '管理企业插件',
  'dashboard.read': '查看运行总览',
  'users.read': '查看用户',
  'users.write': '管理用户',
  'teams.read': '查看团队',
  'teams.write': '管理团队',
  'roles.read': '查看角色',
  'roles.write': '管理角色权限',
  'plans.read': '查看套餐',
  'plans.write': '管理套餐',
  'orders.read': '查看订单',
  'orders.write': '处理订单',
  'channels.read': '查看模型渠道',
  'channels.write': '管理模型渠道',
  'models.read': '查看模型目录',
  'models.write': '管理模型目录',
  'usage.read': '查看用量',
  'usage.write': '录入用量',
  'audit.read': '查看审计日志',
  'settings.read': '查看系统设置',
  'settings.write': '修改系统设置',
}

export const PERMISSION_GROUPS: Array<{ label: string; permissions: string[] }> = [
  { label: '工作台', permissions: ['workspace.use', 'workspace.resources.write', 'dashboard.read'] },
  { label: '组织管理', permissions: ['users.read', 'users.write', 'teams.read', 'teams.write', 'roles.read', 'roles.write'] },
  { label: '插件', permissions: ['plugins.builtin.write', 'plugins.enterprise.write'] },
  { label: '套餐与订单', permissions: ['billing.purchase', 'plans.read', 'plans.write', 'orders.read', 'orders.write'] },
  { label: '模型与用量', permissions: ['channels.read', 'channels.write', 'models.read', 'models.write', 'usage.read', 'usage.write'] },
  { label: '安全治理', permissions: ['audit.read', 'settings.read', 'settings.write'] },
]
