---
description: "面向 DSH Web 部署的企业登录、管理后台与受保护工作台启动入口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-console

[English](README.md) | 中文

## 概述

这是一个可选启用的 Host 插件，为 DSH Web 提供企业登录页、管理后台和经过认证的租户网关。`/enterprise/` 负责账号、团队、角色、套餐、模型渠道、用量和审计管理。每个启用中的团队都拥有独立的 rootless Podman 容器、DSH Web 进程和 `/t/<团队标识>/harness/` 入口，并分别使用自己的 DSH Home、工作区、会话历史、凭据和浏览器认证密钥。控制面以非特权服务账号运行；容器合同与验证矩阵见[租户隔离文档](docs/TENANT-ISOLATION.md)（[中文版](docs/TENANT-ISOLATION.zh.md)）。

## 目录

- [使用本包](#use-this-package)
- [认证与 Harness 访问](#authentication-and-harness-access)
- [插件](#plugins)
- [团队资源](#team-resources)
- [远程浏览器](#remote-browser)
- [套餐与额度](#billing-and-quota)
- [精选智能体与积分](#curated-agents-and-points)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

构建企业前端，并通过仓库 overlay 挂载插件：

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-web build
pnpm dsh web --patch packages/experimental/enterprise-console/cordis.patch.yml
```

打开 `/` 进入 AI 工作台时，未登录访问始终跳转到 `/enterprise/login`；系统不存在访客租户或共享匿名工作台。已有会话会启动当前用户的团队容器并跳转到团队网关入口。`/enterprise/` 仍是控制台的直接入口，`/enterprise/workspace` 是启动门禁。首次启动会创建私有数据目录、在 `<dataDir>/enterprise.sqlite` 初始化 SQLite 管理数据，并把初始管理员密码写入 `<dataDir>/initial-admin-password.txt`，该文件仅所有者可读。登录并修改密码后应删除此文件。备份时应同时保留 `enterprise.sqlite`、`session.key` 和 `credential.key`。

配置项：

- `distRoot` —— 构建后的企业前端目录。
- `dataDir` —— 持久化 SQLite 目录、签名密钥和加密渠道凭据。
- `bootstrapAdminEmail` —— 首个管理员邮箱，仅在初始化时使用。
- `brandName` —— 控制台显示的产品名称。
- `tenantRoot` —— 保存每团队 DSH Home 和工作区的私有目录。
- `tenantDshEntry` —— 以只读方式挂载进租户容器的构建产物 `apps/cli/lib/bin.js`。
- `tenantSourceRoot` —— 仓库构建树；其中 `apps`、`packages`、`node_modules`、`native`、`vendor` 和包元数据以只读方式挂载。
- `tenantTemplateHome` —— 为新租户复制 Web profile 和模型凭据的模板 Harness Home。
- `tenantProfile` —— 所有租户容器加载的 profile 名称。
- `tenantPublicOrigin` —— 可选的浏览器公开源；默认取 Web 服务的公开地址源。
- `verificationWebhookUrl` / `verificationWebhookToken` —— 用于发送邮箱或短信验证码的 HTTPS 网关与可选 Bearer 令牌；省略 URL 时验证码登录和自助注册不可用。
- `tenantContainerImage` / `tenantContainerPodman` —— rootless 镜像与 Podman 可执行文件。
- `tenantContainerMemoryMb` / `tenantContainerPids` —— 每个容器的硬内存和 PID 上限。
- `tenantPortStart` / `tenantPortEnd` —— 分配给租户容器的本地回环端口范围。
- `maxTenantProcesses`、`tenantIdleTimeoutMinutes`、`tenantStartTimeoutMs` —— 容器容量与生命周期限制。启动超时同时约束每条 Podman 准备命令；平台检查失败后，下次启动请求可以重新检查。
- `browserChromePath` / `browserXvfbPath` —— 企业宿主上的有头 Chromium 与 Xvfb 可执行文件。
- `browserProxyUrl` / `browserProxyBypass` —— 可选的 Chromium 代理与绕过列表。
- `browserMaxSessions` / `browserMaxSessionsPerUser` / `browserIdleTimeoutMinutes` —— 远程浏览器容量与空闲回收。
- `browserNavigationTimeoutMs` —— 单次远程页面导航的最长等待时间。

<a id="authentication-and-harness-access"></a>
## 认证与 Harness 访问

插件签发 HttpOnly、SameSite=Lax 企业会话 Cookie。账号使用邮箱地址或管理员绑定的手机号与密码登录。配置验证 Webhook 后，同一标识还可以使用一次性邮箱或短信验证码登录。所有已登录账号都可以从控制台或 Harness 的账号菜单进入“修改密码”；修改后会话会轮换，其他设备上的登录随即失效。自助注册默认关闭；开启后，通过验证的注册者会以默认角色加入配置的默认团队，并受团队席位限制。所有者角色由系统内置且不可修改；只有所有者可以管理角色、分配管理员或所有者角色，管理员只能添加和管理普通成员。验证码 10 分钟过期、不可复用、最多尝试 5 次，并按标识和请求来源限流。每个写操作校验浏览器来源，每个管理路由校验登录角色是否拥有对应权限；成功的写操作会追加审计记录。

<a id="plugins"></a>
## 插件

所有者添加并控制全员共享的内置插件，也可以添加仅在本企业生效的插件；管理员可以添加和管理仅在本企业生效的插件，但不能修改内置插件。租户工作台隐藏插件管理页，并拒绝 Agent 的插件管理调用；网关只放行插件读取 RPC，其余插件变更请求全部拒绝。

验证 Webhook 接收 `POST` JSON，字段包括 `identifier`、`channel`、`code`、`purpose`、`brandName` 和 `expiresInSeconds`；网关在将消息交给部署方的邮件或短信服务商后必须返回 2xx。远程 Webhook 地址必须使用 HTTPS。控制台不内置邮件或短信服务商；没有可用网关时，密码登录保持可用，验证码登录和注册入口会隐藏。

`GET /enterprise/api/harness/launch` 先把未登录请求跳转到登录页，再解析当前用户的团队，拒绝未分配或已停用的团队，按需启动该团队的 rootless 容器，写入启动审计，然后跳转到 `/t/<团队标识>/harness/`。网关自行认证每个 HTTP 请求和 WebSocket 升级，校验会话确实属于 URL 中的团队，并拒绝跨租户、停用团队和无权限访问。

DSH 启动令牌只在 Host 进程内部交换。租户 Cookie 和启动令牌不会进入浏览器、URL 或日志。网关只在对本地回环进程的请求中注入租户 Cookie，移除上游的所有 `Set-Cookie`，并重写内部跳转。Harness 页面会加载 `/enterprise/session-guard.js`，把侧栏和空会话首页品牌替换为织流，并把账号入口替换为企业身份和头像；有管理权限的角色可从菜单进入管理控制台，所有成员都可修改密码、打开工作台设置或退出登录。守卫会在窗口聚焦、页面可见性变化以及每 15 秒重新校验企业会话；会话被撤销后立即返回登录页。网关每 15 秒重新校验活动 WebSocket。企业退出登录会清除企业 Cookie 和旧版 Harness Cookie。Harness 内部的 DeepSeek 账号入口是独立的模型账号登录，不代表企业身份。

反向代理应把 `/t/` 与 `/enterprise/` 转发到同一个 Host 监听器，为 `/t/<团队标识>/harness/api/remote.mux` 保留 WebSocket 升级头，并停止暴露任何共享 `/harness/` 路由。租户授权由网关完成，因此 `/t/` 不需要额外的 `auth_request`；重复校验同一个企业 Cookie 不会增加隔离强度。

<a id="team-resources"></a>
## 团队资源

资源分组挂载在侧栏的面板导航内部，展开与收起时均为资源行保留空间，再排列下方的项目列表。

租户侧栏的资源分组会在当前 Harness 工作台内打开[团队资源面板](../client-ui-enterprise-resources/README.zh.md)。选择文件、知识库或技能时，URL 保持在 `/t/<团队标识>/harness/` 下并切换主面板，不会跳转到 `/enterprise/resources/*` 管理页面或外部服务。具备 `workspace.use` 的团队成员都可以浏览团队共享资源；写操作额外要求 `workspace.resources.write`，所有者角色默认拥有该权限，成员看到相同的文件、知识和技能但没有修改入口。租户资源面板从登录用户解析团队；`/enterprise/resources/*` 管理页面仅向拥有 `teams.read` 的角色显示团队选择器，并发送所选团队的 `teamId`。API 会拒绝依赖未分配或已停用自有团队的请求，拒绝缺少 `teams.read` 的跨团队访问，并在每个写操作中校验浏览器来源。

文件根目录是 `<tenantRoot>/<team-id>/documents/deepseek-harness/default-workspace`，即该团队 Harness 进程使用的默认工作区。控制台支持目录导航、新建目录、上传、文本预览与编辑、重命名、删除和流式下载。单次上传上限为 20 MiB；在线编辑上限为 2 MiB，并且必须是严格 UTF-8 文本。隐藏路径、绝对路径、`..`、符号链接和非普通文件都会被拒绝。Linux 上每次目录遍历都通过 `/proc/self/fd`、已打开的目录描述符和 `O_NOFOLLOW` 固定路径，避免检查后替换。

技能从 `<tenantRoot>/<team-id>/home/skills` 读取并写入该目录。控制台创建 `<name>/SKILL.md` 形式的目录技能，也支持管理和编辑已有的扁平 `<name>.md` 技能。该目录属于租户的 `DSH_HOME`，标准 `skill-filesystem` 提供方会直接发现同一批文件，不需要导入或第二套存储。`team-knowledge` 名称保留给知识库生成器，不能从技能页面修改或删除。

知识条目保存在 `<tenantRoot>/<team-id>/resources/knowledge/articles.json`，支持列表、新建、编辑和删除。每次成功变更都会重新生成 `<home>/skills/team-knowledge/SKILL.md` 和每个条目对应的 Markdown 参考文件，团队 Agent 可以通过正常技能目录按需加载团队政策与运行手册。知识库为空时会删除生成技能。知识库最多保存 500 条、4 MiB JSON；单条正文上限为 128 KiB。

每个团队的文件、技能和知识都保存在自己的子树内，控制台不会把一个团队的目录与另一个团队合并。该目录绑定进对应团队的 rootless 容器；资源管理没有向租户新增宿主挂载、设备、凭据或 Podman 能力。控制面只在通过 `teams.read` 校验后写入所选团队的子树，租户仍然无法访问企业 SQLite、会话密钥、其他团队目录或容器运行时套接字。

<a id="remote-browser"></a>
## 远程浏览器

企业外壳把侧边栏浏览器从 iframe 切换为宿主 Chromium 页面，因此拒绝 iframe 嵌入的站点也能正常显示。控制台在私有 Xvfb 显示上启动有头 Chromium，校验地址，并通过经过认证的同源事件流发送 JPEG 画面。指针、滚轮、键盘、粘贴、导航和视口尺寸操作复用企业会话 Cookie，并要求 `workspace.use` 权限。

会话按团队和用户隔离。即使知道不透明的会话 ID，成员也不能控制或观察其他成员的 Chromium 页面。浏览器池同时限制单用户数量和宿主总量，并回收长期空闲页面；关闭浏览器标签会结束对应 Chromium 上下文并删除临时 profile。

只接受公网 HTTP(S) 地址。包含凭据、字面 IP、`localhost`、`.localhost`、`.local`、`.internal` 名称或指向企业自身的 URL 都会被拒绝。Chromium 使用隔离的临时 profile，禁用下载，不暴露调试端口，并拦截发往企业源的子资源请求。部署方需要安装配置指定的 Chromium 与 Xvfb；公开站点需要代理出口时也要提供可用代理。该浏览器运行在企业控制面进程中，不进入租户容器。

<a id="billing-and-quota"></a>
## 套餐与额度

团队共享当前套餐按 UTC 自然月计算的 `monthlyCredits`。拥有 `billing.purchase` 的所有者可以在 `/enterprise/billing` 购买或续费套餐；存在待确认订单时不能再次下单，由拥有 `orders.write` 的管理员确认或拒绝。工作台显示套餐和已用百分比，并可跳到该页面；绝对 Token 数量留在管理界面。普通输入区隐藏新任务模式、模型与权限选择器，实际行为仍由服务端已有默认值和授权控制。

租户浏览器插件在每轮完成后把模型服务返回的 Token 用量提交到 `POST /enterprise/api/billing/usage`；服务端按 `sessionId` 与 `turn` 只记录一次 `inputTokens + outputTokens`。计量在浏览器执行，因此页面关闭期间完成的轮次不会计量，额度耗尽目前也不会阻断模型请求。

<a id="curated-agents-and-points"></a>
## 精选智能体与积分

`/enterprise/agents` 展示已发布智能体、成员使用权、积分与任务；`/enterprise/admin/agents` 要求 `settings.write`，管理提示词、Skill 说明、模型、执行器、价格、时长、发布、成员消费权限及用量核对。草稿可以先保存再选择模型；发布要求已配置费率且执行器就绪。管理员显式分配每位成员的钱包与权限，加入团队本身不会共享余额或智能体权益。

独立的 `<dataDir>/product.sqlite` 保存整数微积分、购买、授权、任务、完整且去除凭据的模型请求及用量结算。备份时同时保留 `credential.key` 与 `<dataDir>/product-jobs`。购买标识保证幂等扣费；30 天按购买成功后连续 30 个 24 小时计算，并支持自定义时长与永久权益。解锁购买使用权，每次运行仍单独消耗积分。输入／输出费率以模型服务返回的每百万 Token 对应整数积分配置。服务端在请求前预留上下文预算、冻结费率并一次结算实际用量；中断或缺少用量的请求保留预留积分，等待管理员核对。原有 Harness 聊天仍走独立的浏览器上报额度链路。

`productPptSkillRoot`／`DSH_PRODUCT_PPT_SKILL_ROOT` 指向经核验的 PPT Master 安装，`productPython`／`DSH_PRODUCT_PYTHON` 指向配套 Python 环境。模型与导出超时默认 240000／180000 毫秒，输出上限 12000 Token，并发为 2（`productModelTimeoutMs`、`productExportTimeoutMs`、`productMaxOutputTokens`、`productConcurrency`；对应 `DSH_PRODUCT_*` 变量见 overlay）。用户明确选择基于所给材料快速制作 3–6 页 SVG，再导出原生可编辑 PPTX；此流程没有外部研究、图片或备注。PPT Master 执行最终质量与导出检查，下载校验任务所有者。支持文本执行，视频执行器尚待接入；初始数据未设置商业售价或用量费率。

<a id="model-experience"></a>
## 模型体验

间接依赖现有的 `skill-filesystem` 技能目录和 `skill` 工具；它们向模型提供用户技能与 `team-knowledge`，知识参考文件仍是普通工作区文件，普通资源面板没有增加提示词、工具或 Session 事件。产品任务另外发送后台配置的提示词、Skill 和用户材料。文本任务还可凭成员在侧边栏登录时保存的授权调用租户的飞链知识库工具（`feilian_kb_search` 与 `feilian_kb_page`），让回答引用已编译的知识页面；其完整请求与模型报告用量持久保存在产品请求记录中，独立于 Harness Session。

#### KV Cache 影响

新建或删除技能、修改技能描述会改变技能目录，并可能使下一次请求的提示词缓存前缀失效。只修改技能正文时，新内容仅在下一次显式加载时生效；编辑文件或知识条目但不改变技能目录，不会修改请求前缀。重新生成 `team-knowledge` 时会保持目录条目稳定，只替换后续加载返回的内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- rootless 容器共享宿主内核。内核、Podman、crun 和租户镜像仍属于可信组件，必须持续修补。
- 当前宿主 user slice 只委派了 memory 与 PID 控制器，因此没有强制 CPU 配额；完整的残余风险分析见[租户隔离文档](docs/TENANT-ISOLATION.md)（[中文版](docs/TENANT-ISOLATION.zh.md)）。
- 容器回收会保留租户 DSH Home 和工作区。删除企业团队数据目前不会同步删除对应的私有租户目录。
- 计费是手动回执的管理账本，不集成在线支付服务商。
- 轮次计量由浏览器上报，额度耗尽不会阻断请求。
- 模型渠道凭据在静态存储中加密，但属于管理元数据；把它们接入模型路由仍由 Harness 模型提供方配置负责。
- 验证码投递依赖部署方的 HTTPS Webhook 网关；控制台本身不内置邮件或短信服务商。
- 远程 Chromium 会拒绝字面 IP 和私有后缀，但不会在导航前解析第三方主机名；部署方仍须以网络出口策略作为安全边界。
- 飞链工具调用仅用于文本智能体，并复用成员在侧边栏保存的租户级授权；PPT 执行器仍是一次不带工具调用的补全。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

## 反向代理子路径

设置 `DSH_ENTERPRISE_PATH_PREFIX=/preview`（插件配置 `publicPathPrefix`），并使用相同变量构建企业前端。入口代理须在转发 HTTP 和 WebSocket 请求前剥离此前缀。默认前缀为空；已配置前缀由斜杠分隔的字母、数字、下划线或连字符组成，末尾不带斜杠。公开链接、租户资源地址、会话 Cookie 名称与路径、退出通知通道均限定在此挂载路径。`DSH_ENTERPRISE_PUBLIC_ORIGIN` 仅填写 HTTPS 源地址，不包含路径。子路径仍与主站共享浏览器源，并非浏览器源层面的隔离。

工作台中的智能体市场与精简套餐／积分摘要现在在当前客户端文档内打开，仅显式的管理详情链接打开新标签。新建项目通过 `/resources/projects/location` 解析已认证团队的沙箱目录，不接收任意主机路径。网页预览使用服务器目录，桌面端保留原生本地目录选择器。
