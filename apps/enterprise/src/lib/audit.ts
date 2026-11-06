export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login': '登录',
  'auth.logout': '退出登录',
  'auth.password_change': '修改密码',
  'workspace.launch': '启动工作台',
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.delete': '删除用户',
  'team.create': '创建团队',
  'team.update': '更新团队',
  'team.delete': '删除团队',
  'role.create': '创建角色',
  'role.update': '更新角色',
  'role.delete': '删除角色',
  'plan.create': '创建套餐',
  'plan.update': '更新套餐',
  'plan.delete': '删除套餐',
  'order.create': '创建订单',
  'order.approve': '确认订单',
  'order.reject': '拒绝订单',
  'channel.create': '创建渠道',
  'channel.update': '更新渠道',
  'channel.delete': '删除渠道',
  'model.create': '创建模型',
  'model.update': '更新模型',
  'model.delete': '删除模型',
  'usage.record': '记录用量',
  'settings.update': '更新设置',
  'system.bootstrap': '系统初始化',
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

export function auditTone(action: string): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (action === 'user.delete' || action === 'team.delete' || action === 'role.delete' || action === 'plan.delete' || action === 'channel.delete' || action === 'model.delete' || action === 'order.reject') return 'danger'
  if (action === 'auth.login' || action === 'workspace.launch') return 'success'
  if (action.startsWith('auth.') || action.startsWith('settings.')) return 'warning'
  return 'info'
}
