import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const source = process.argv[2] ?? process.env.AGENCY_ASSETS
if (!source) {
  console.error('usage: node import-experts.mjs <agency-agents-zh dir>')
  process.exit(1)
}

const CATEGORIES = {
  academic: ['学术', 'knowledge'],
  company: ['公司经营', 'strategy'],
  design: ['设计', 'image'],
  engineering: ['工程', 'operations'],
  finance: ['财务', 'finance'],
  'game-development': ['游戏开发', 'video'],
  gis: ['地理信息', 'knowledge'],
  healthcare: ['医疗健康', 'chat'],
  hr: ['人力资源', 'organization'],
  legal: ['法务', 'legal'],
  marketing: ['营销', 'marketing'],
  'paid-media': ['付费媒体', 'growth'],
  product: ['产品', 'strategy'],
  'project-management': ['项目管理', 'organization'],
  research: ['研究', 'knowledge'],
  sales: ['销售', 'growth'],
  security: ['安全', 'legal'],
  'spatial-computing': ['空间计算', 'image'],
  specialized: ['综合专项', 'spark'],
  'supply-chain': ['供应链', 'operations'],
  support: ['客户支持', 'chat'],
  testing: ['测试', 'operations'],
}

function parse(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/u)) {
    const field = /^([A-Za-z_-]+):\s*(.*)$/u.exec(line)
    if (!field) continue
    meta[field[1]] = field[2].trim().replace(/^"(.*)"$/u, '$1')
  }
  return { meta, body: text.slice(match[0].length).trim() }
}

function sectionHeadings(body, test) {
  const headings = []
  let inside = false
  for (const line of body.split(/\r?\n/u)) {
    if (/^##\s/u.test(line)) {
      inside = test.test(line.replace(/^##\s+/u, ''))
      continue
    }
    if (!inside) continue
    const heading = /^###\s+(.+)$/u.exec(line)
    if (heading) headings.push(heading[1].trim())
  }
  return headings
}

function firstHeading(body) {
  const heading = /^###\s+(.+)$/mu.exec(body)
  return heading ? heading[1].trim() : ''
}

const experts = []
const bySlug = new Map()
const categories = Object.keys(CATEGORIES)
for (const [categoryIndex, directory] of categories.entries()) {
  const label = CATEGORIES[directory][0]
  const icon = CATEGORIES[directory][1]
  const files = (await readdir(join(source, directory))).filter(name => name.endsWith('.md')).sort()
  for (const [index, file] of files.entries()) {
    const id = file.replace(/\.md$/u, '')
    const { meta, body } = parse(await readFile(join(source, directory, file), 'utf8'))
    const title = meta.name?.trim()
    const description = meta.description?.trim()
    if (!title || !description) throw new Error(`missing name or description: ${file}`)
    const tasks = sectionHeadings(body, /使命|工作/u)[0] ?? firstHeading(body)
    const deliverables = sectionHeadings(body, /交付/u)[0] ?? ''
    const expert = {
      id,
      title,
      description,
      alias: '',
      group: label,
      category: label,
      icon,
      tasks,
      materials: '任务背景、目标、已有材料与约束条件',
      deliverables: deliverables || '专业分析、行动建议与执行清单',
      example: `以${title}的视角，帮我完成一次「${tasks || label}」分析与建议。`,
      disclaimer: '',
      sortOrder: categoryIndex * 1000 + index * 10,
      recommended: false,
      output: 'text',
      executor: 'text',
      price: 0,
      durationDays: 30,
      published: true,
      modelId: 'model-deepseek-chat',
      systemPrompt: body,
      skill: '按你的专业方法完成分析，区分事实与假设，给出可执行的下一步；不编造数据。',
      kind: 'expert',
      members: [],
    }
    experts.push(expert)
    bySlug.set(id, expert)
  }
}

const TEAMS = [
  {
    id: 'team-product-review', title: '产品方案评审团', icon: 'strategy',
    description: '从需求价值、用户体验与工程可行性三个方向评审产品方案，给出优先级与行动清单。',
    tasks: '需求价值判断\n体验与可行性评审\n优先级排序',
    deliverables: '评审结论、优先级与行动清单',
    example: '我们准备做一个面向中小企业老板的 AI 经营助手，帮我评审方案并排优先级。',
    members: ['product-manager', 'design-ux-researcher', 'design-ux-architect', 'engineering-backend-architect', 'product-sprint-prioritizer'],
  },
  {
    id: 'team-tech-review', title: '技术方案评审团', icon: 'operations',
    description: '从架构、安全与验收边界评审技术方案，识别风险并形成验收清单。',
    tasks: '架构成熟度评审\n安全与合规检查\n验收边界确认',
    deliverables: '风险清单、验收标准与改进建议',
    example: '这是我们新系统的技术方案，帮我评审架构、安全与上线验收要点。',
    members: ['engineering-software-architect', 'engineering-backend-architect', 'security-architect', 'testing-reality-checker', 'engineering-code-reviewer'],
  },
  {
    id: 'team-content-planning', title: '内容选题策划团', icon: 'marketing',
    description: '围绕选题角度、传播策略与事实核验策划内容，产出选题方案与结构。',
    tasks: '选题角度策划\n传播策略设计\n事实与引用核验',
    deliverables: '选题方案、内容结构与传播建议',
    example: '我们下月要围绕企业 AI 落地做一轮内容，帮我策划 5 个选题和结构。',
    members: ['marketing-content-creator', 'marketing-daily-news-briefing', 'marketing-baidu-seo-specialist', 'design-visual-storyteller', 'research-synthesist'],
  },
  {
    id: 'team-data-diagnosis', title: '数据分析诊断团', icon: 'growth',
    description: '从指标口径、数据质量与业务解释诊断经营数据，给出结论与验证步骤。',
    tasks: '指标体系梳理\n数据质量检查\n业务归因分析',
    deliverables: '诊断结论、验证步骤与改进建议',
    example: '最近两个月转化率下降，这是我们的漏斗数据，帮我诊断原因。',
    members: ['support-analytics-reporter', 'engineering-data-engineer', 'engineering-data-visualization-engineer', 'finance-financial-analyst', 'specialized-pricing-analyst'],
  },
  {
    id: 'team-research', title: '专题研究专家团', icon: 'knowledge',
    description: '围绕研究范围、证据质量与综合判断开展专题研究，输出有依据的结论。',
    tasks: '研究范围界定\n证据收集与评估\n综合判断与结论',
    deliverables: '有来源的研究结论与待验证问题',
    example: '帮我研究一下国内中小企业采用 AI 工具的主要障碍，并给出证据。',
    members: ['research-synthesist', 'academic-historian', 'academic-geographer', 'healthcare-clinical-evidence-agent', 'finance-investment-researcher'],
  },
]

const teams = TEAMS.map((team, index) => {
  const members = team.members.filter(id => bySlug.has(id))
  if (members.length !== team.members.length) throw new Error(`team ${team.id} references missing experts`)
  const roster = members.map(id => {
    const expert = bySlug.get(id)
    return `- ${expert.title}：${expert.description}`
  }).join('\n')
  return {
    id: team.id,
    title: team.title,
    description: team.description,
    alias: '',
    group: '专家团',
    category: '专家团',
    icon: team.icon,
    tasks: team.tasks,
    materials: '',
    deliverables: team.deliverables,
    example: team.example,
    disclaimer: '',
    sortOrder: index * 10,
    recommended: index < 3,
    output: 'text',
    executor: 'text',
    price: 0,
    durationDays: 30,
    published: true,
    modelId: 'model-deepseek-chat',
    systemPrompt: [
      `你是织流「${team.title}」的主理人，负责组织团队完成用户提交的任务。`,
      `团队成员与专长：\n${roster}`,
      '收到任务后按以下顺序工作：',
      '1. 用一句话复述目标、已知条件与约束；',
      '2. 按每位成员的专业视角分别给出判断，区分事实、假设与证据缺口；',
      '3. 指出成员之间的分歧、关键风险与需要用户确认的问题；',
      '4. 汇总为优先级清晰的行动清单和验收标准。',
      '不要编造数据；材料不足时明确列出需要补充的信息。统一使用中文交付。',
    ].join('\n\n'),
    skill: '先明确目标与约束，再按成员分工输出，最后汇总分歧与行动清单。',
    kind: 'team',
    members,
  }
})

await writeFile(new URL('../catalog/experts.json', import.meta.url), `${JSON.stringify(experts, null, 2)}\n`)
await writeFile(new URL('../catalog/teams.json', import.meta.url), `${JSON.stringify(teams, null, 2)}\n`)
console.log(`experts: ${experts.length}, teams: ${teams.length}`)