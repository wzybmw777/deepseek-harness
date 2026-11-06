/** Built-in optional bundles an enterprise owner can enable for every tenant. */

import { OPTIONAL_BUNDLES } from '@deepseek-ai/dsh-official-bundles'

/** Display metadata for one installation-provided bundle. */
export interface BuiltinPluginDefinition {
  readonly packageName: string
  readonly label: string
  readonly description: string
}

const BUILTIN_LABELS: Readonly<Record<string, { label: string; description: string }>> = {
  '@deepseek-ai/dsh-personalized-recommendations': { label: '个性推荐', description: '基于当前工作内容提供建议。' },
  '@deepseek-ai/dsh-experimental-session-search': { label: '会话搜索', description: '搜索历史会话。' },
  '@deepseek-ai/dsh-experimental-ralph-bundle': { label: 'Ralph', description: '自主迭代任务执行。' },
  '@deepseek-ai/dsh-experimental-terminal-bundle': { label: '持久终端', description: '跨轮次保留终端会话。' },
  '@deepseek-ai/dsh-experimental-badge-skill-bundle': { label: '徽章技能', description: '在界面中展示技能徽章。' },
  '@deepseek-ai/dsh-experimental-session-titles-bundle': { label: '会话标题', description: '自动生成会话标题。' },
  '@deepseek-ai/dsh-experimental-agent-team-profile': { label: '智能体团队', description: '协调多个智能体共同完成任务。' },
  '@deepseek-ai/dsh-experimental-voice-input-bundle': { label: '语音输入', description: '使用语音输入消息。' },
  '@deepseek-ai/dsh-experimental-cot-translation-bundle': { label: '推理翻译', description: '转写并翻译推理过程。' },
  '@deepseek-ai/dsh-experimental-auto-review': { label: '自动审查', description: '自动检查交付结果。' },
  '@deepseek-ai/dsh-experimental-inspector-profile': { label: '运行时检查器', description: '查看运行时与插件状态。' },
  '@deepseek-ai/dsh-experimental-liveshare': { label: '实时共享', description: '共享活动会话。' },
  '@deepseek-ai/dsh-experimental-plugin-market-bundle': { label: '插件市场', description: '浏览并安装插件。' },
  '@deepseek-ai/dsh-experimental-tool-worktree': { label: '工作树工具', description: '在独立工作树中执行任务。' },
  '@deepseek-ai/dsh-experimental-forge-bundle': { label: 'Forge', description: '扩展工作台实验能力。' },
}

/** Installation-provided bundles available to the enterprise plugin policy. */
export const BUILTIN_PLUGINS: readonly BuiltinPluginDefinition[] = OPTIONAL_BUNDLES.map((packageName) => {
  const display = BUILTIN_LABELS[packageName]
  return {
    packageName,
    label: display?.label ?? packageName.split('/').at(-1) ?? packageName,
    description: display?.description ?? '',
  }
})

/** Stable API identity for a built-in bundle policy. */
export function builtinPluginId(packageName: string): string {
  return `builtin:${packageName}`
}
