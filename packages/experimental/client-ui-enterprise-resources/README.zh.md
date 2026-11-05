---
description: "在 Harness 工作台内管理团队文件、知识库和文件系统技能，无需离开租户会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-enterprise-resources

[English](README.md) | 中文

## 概述

租户侧栏中的文件、知识库和技能入口会在当前 Harness 工作台内打开。团队成员可以在 `/t/<团队标识>/harness/` 内浏览共享的文件、知识和技能；具备 `workspace.resources.write` 的账号（默认包括所有者）同时获得编辑入口。所有操作都调用企业同源资源 API，并使用当前登录用户所属团队。插件没有增加团队选择器、共享访客工作区或第二套存储；现有文件系统技能提供方会发现同一批技能和生成的 `team-knowledge` 内容。

## 目录

- [使用本包](#use-this-package)
- [实现原理](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

企业租户运行时会把本插件插入每个团队生成的 patch。插件没有配置字段，Host 导出为空实现；浏览器入口注册三个主面板和侧栏桥接。

在侧栏的资源分组中选择**文件**、**知识库**或**技能**时，URL 保持不变，并在主区域打开对应面板。所有成员都可以浏览目录、预览文件和查看知识、技能。具备写权限的账号还可以上传、新建文件夹、重命名、删除、编辑文本文件、维护知识条目和团队编写的技能；知识库生成的技能保持只读。失败会留在当前页面，提供重试或关闭提示。

这些页面只在企业 Host 插件提供认证资源 API 时可用。它们不是独立的管理站点，也不会接受浏览器传入的团队标识。

同一个浏览器插件会在每轮完成后，把模型服务返回的 Token 用量上报到 `/enterprise/api/billing/usage`。企业 Host 按 Session 和轮次去重，并计入登录用户所属团队。

-----

<a id="understand-the-implementation"></a>
## 实现原理

<details>
<summary>实现细节——点击展开</summary>

浏览器插件拥有 `enterprise-files`、`enterprise-knowledge` 和 `enterprise-skills` 三个主插槽键。企业侧栏派发 `dsh-enterprise-resource-open`；插件校验请求的资源类型后调用 `ctx.layout.selectPanel`。对 `layout.panelInfo` 的订阅会派发 `dsh-enterprise-resource-active`，驱动侧栏选中状态。插件 fiber 卸载时会移除插槽条目、词典和两个 DOM 订阅。

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

间接依赖现有的 `skill-filesystem` 技能目录和 `skill` 工具；它们发现团队编写的技能和生成的 `team-knowledge` 技能，浏览器页面本身没有增加提示词、工具或 Session 事件。

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
