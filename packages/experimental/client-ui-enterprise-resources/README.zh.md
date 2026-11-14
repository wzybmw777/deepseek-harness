---
description: "在 Harness 工作台内管理团队文件、知识库和文件系统技能，无需离开租户会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-enterprise-resources

[English](README.md) | 中文

## 概述

租户侧栏中的文件、知识库和技能入口会在当前 Harness 工作台内打开。团队成员可以在 `/t/<团队标识>/harness/` 内浏览共享的文件、知识和技能；具备 `workspace.resources.write` 的账号（默认包括所有者）同时获得编辑入口。所有操作都调用企业同源资源 API，并使用当前登录用户所属团队。插件没有增加团队选择器、共享访客工作区或第二套存储；现有文件系统技能提供方会发现同一批技能和生成的 `team-knowledge` 内容。

## 目录

- [使用本包](#use-this-package)
- [工作台市场、积分和项目目录](#workbench-market-usage-and-project-folders)
- [实现原理](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

企业租户运行时会把本插件插入每个团队生成的 patch。插件没有配置字段，Host 导出为空实现；浏览器入口注册四个主面板、锚定积分摘要、两处项目目录流程及侧栏桥接。

在侧栏的资源分组中选择**文件**或**知识库**时，URL 保持不变，并在主区域打开对应面板。所有成员都可以浏览目录、预览文件和查看知识、技能。具备写权限的账号还可以上传、新建文件夹、重命名、删除、编辑文本文件、维护知识条目和团队编写的技能；知识库生成的技能保持只读。失败会留在当前页面，提供重试或关闭提示。

这些页面只在企业 Host 插件提供认证资源 API 时可用。它们不是独立的管理站点，也不会接受浏览器传入的团队标识。

同一个浏览器插件会在每轮完成后，把模型服务返回的 Token 用量上报到 `/enterprise/api/billing/usage`。企业 Host 按 Session 和轮次去重，并计入登录用户所属团队。

-----

默认侧栏展示文件、知识库和智能体；原有资源界面仍保留技能管理。知识面板管理本包内置的团队知识库。

资源请求和用量上报从当前租户挂载路径解析公开部署前缀，因此 `/preview/t/<团队标识>/harness/` 下的工作台使用 `/preview/enterprise/api/`，避免把资源变更或计费上报发送到源站根路径的部署。

<a id="workbench-market-usage-and-project-folders"></a>
## 工作台市场、积分和项目目录

市场选择在侧栏首个已登记项目中新建对话；尚无项目时尝试初始化默认项目。其他对话的草稿保持原样，提交前仍可切换项目。所选智能体的名称会作为该对话的标题，未命名会话因此能直接在项目列表里辨认。

智能体入口在当前文档内打开原生市场面板，用于发现、分类、搜索和解锁。解锁后通过现有聊天框的 @ 交互选择智能体；知识库 chip 可先于智能体 token 出现，选中智能体后该 chip 保留为任务材料；执行状态、回复和经过所有者校验的文件下载从持久化命令引用恢复，统一出现在对应对话的历史记录中，不单独提供作品库。已认证产品 API 继续校验权限、有效期、预留积分和实际用量结算。当前智能体执行器接收文字材料，附件仍在普通对话处理。套餐入口打开精简的使用进度与可用积分浮层，有权限的用户主动点击后才会在新标签打开管理详情。现有套餐额度与产品积分钱包仍分别统计。

聊天框的 @ 菜单另外提供「飞链知识库」分组，列出当前租户在侧边栏页面登录后可读的知识库。选中后插入知识库引用；引用在提交时序列化为 `@名称 [飞链知识库 id=…]` 一行文本，消息视图再把它渲染回 chip，模型据此用飞链插件自带的 `feilian_kb_search` / `feilian_kb_page` 工具检索该知识库。未登录时该分组只提供「登录飞链知识库」，点击直接打开侧边栏页面。

网页预览的新建项目仅浏览当前团队沙箱，支持路径导航和新建文件夹，向原有工作区所有者传回经过服务端验证的目录；此流程不上传电脑文件夹。桌面端保留原生 Windows 文件夹选择器，新样式向桌面端共用留待后续接入。新建目录继续要求写权限。两处目录流程单插槽以 -100 优先级有意覆盖，积分摘要列表插槽提供独立 id。错误提供原位重试。

新增文案提供中英两套词条，其余受支持语言在这些新增词条上使用英文。

<a id="understand-the-implementation"></a>
## 实现原理

<details>
<summary>实现细节——点击展开</summary>

浏览器插件拥有 `enterprise-files`、`enterprise-knowledge`、`enterprise-skills` 和 `enterprise-market` 四个主插槽键。企业侧栏派发 `dsh-enterprise-resource-open`；插件校验请求的资源类型后调用 `ctx.layout.selectPanel`。对 `layout.panelInfo` 的订阅会派发 `dsh-enterprise-resource-active`，驱动侧栏选中状态。插件 fiber 卸载时会移除插槽条目、词典和两个 DOM 订阅。

页面通过同源 `/enterprise/api/resources/*` 路由读取和修改资源。服务端从登录会话解析团队，因此页面不发送团队标识。文件上传把选中的 `File` 作为请求体，204 变更响应视为成功。收到 401 时页面发出 `enterprise:unauthorized`，交由外层企业守卫处理。

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 主面板注册和侧栏事件桥接 |
| [`src/client/FilesPanel.tsx`](src/client/FilesPanel.tsx) | 工作区文件管理 |
| [`src/client/KnowledgePanel.tsx`](src/client/KnowledgePanel.tsx) | 知识目录和编辑器 |
| [`src/client/SkillsPanel.tsx`](src/client/SkillsPanel.tsx) | 文件系统技能目录和编辑器 |
| [`src/client/common.tsx`](src/client/common.tsx) | 共享页面框架、对话框、通知和错误展示 |
| [`src/client/api.ts`](src/client/api.ts) | 同源资源 API 客户端和响应错误 |
| [`src/client/usage-reporter.ts`](src/client/usage-reporter.ts) | 完成轮次的 Token 上报 |
| [`src/client/feilian-mentions.ts`](src/client/feilian-mentions.ts) | 把一个提问限定到单个飞链知识库的 @ 分组 |
| [`tests/`](tests/) | 面板注册、导航桥接、API 和页面流程测试 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [企业控制台](../enterprise-console/README.zh.md) — 这些页面背后的认证、租户隔离和资源 API。
- [布局](../../client/ui-layout/README.zh.md) — 主面板选择和共享的 `panelInfo` 状态。
- [插槽](../../client/ui-slots/README.zh.md) — 主插槽注册和本地化组件属性。
- [实验性包](../README.zh.md) — 孵化状态和发布策略。

-----

<a id="model-experience"></a>
## 模型体验

间接依赖现有的 `skill-filesystem` 技能目录和 `skill` 工具；它们发现团队编写的技能和生成的 `team-knowledge` 技能，文件与内置知识页面本身没有增加提示词或工具。智能体交互通过既有命令生命周期记录到 Session 日志。智能体私有提示词和技能继续保留在服务端执行器中，与普通 Harness 模型历史分开。

#### KV Cache 影响

新建或删除技能、修改技能描述会改变技能目录，并可能使下一次请求的提示词缓存前缀失效。只修改技能正文时，新内容仅在下一次显式加载时生效。编辑文件或知识条目但不改变技能目录时，请求前缀不变；重新生成的 `team-knowledge` 内容会在 Agent 加载该技能时出现。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **每团队一个工作区** —— 团队成员和 Agent 使用同一个隔离沙盒；界面不提供个人或跨团队文件视图。
- **仅限企业界面** —— 面板依赖企业资源 API，不会回退到公共 Harness 工作区文件 API。
- **没有共享或配额控件** —— 页面不提供公开链接、访客访问、按用户配额、技能市场或推荐内容。
- **限制由服务端拥有** —— 上传、在线编辑、知识条目和存储上限由[企业控制台](../enterprise-console/README.zh.md)执行；界面只展示校验失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
