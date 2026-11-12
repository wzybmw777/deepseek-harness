---
description: "将飞链企业知识库插件作为企业控制台的内置组合包发布。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-feilian-kb

[English](README.md) | 中文

## 概述

此可选组合包把最初以 `dsh-feilian-kb` 安装包发布的飞链知识库插件纳入安装，企业控制台因此把它作为内置插件提供，无需所有者手工粘贴安装地址。启用后侧边栏出现飞链知识库页面，成员用企业账号登录、查看编排目录与来源目录、浏览知识图谱，并配置办公机器人。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在企业控制台打开插件管理，在内置分组中找到“飞链知识库”。添加后该组合包会写入每个租户的 Profile；条目默认关闭，因为页面需要飞链账号。租户重启工作区后从侧边栏页面登录。取消选择即停止写入该页面，Host 会保留已保存的飞链会话，直到成员主动退出登录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息——点击展开</summary>

`cordis.patch.yml` 插入一行 Host 插件，id 为 `feilian-kb`。已发布的 `dsh-feilian-kb@0.2.7` 构建产物被纳入为 `src/index.ts` 与 `src/client/index.ts`，再重新构建到 `lib/`：`lib/index.js` 通过 Host connection 服务注册 `/api/feilian-kb/*` 路由，并把只读 `kb_` 凭据保存在 DSH 凭据库的 `feilian-kb/session` 下；`lib/client.js` 挂载侧边栏页面。客户端构建按包名注册自身，因此包身份必须与插件行一致。

对内置副本的本地改动共四处，均记录在此：patch 中的包名、客户端构建注册 id 的 `@deepseek-ai/` 前缀、以模块导出替代 loader 包装，以及让 `checkPluginUpdate` 返回 null 的 `BUILTIN` 守卫——插件现在随应用一起升级。

`src/index.ts` 与 `src/client/index.ts` 承接已发布的构建产物并作为工作区源码：产品使用门禁需要把可选组合包的行追溯到 workspace 源码，构建时再产出 `lib/` 下的 `index.js` 与 `client.js`。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 知识库工具

#### 模型看到的内容

插件注册 `feilian_kb_search` 与 `feilian_kb_page` 两个工具；成员登录前两者均不可用，且只读取该成员本就可读的知识库中的已编译页面。

#### Token 影响

登录后出现两个工具 schema，并在会话内保持固定。结果文本取决于数据，会一直重发到压缩为止。

#### KV Cache 影响

可见工具集与 schema 不变时前缀稳定。登录或退出会改变工具可用性，可能从第一个变化的 schema token 起使复用失效。


## 已知限制与后续工作

- 内置副本对应一个上游版本。重新纳入更新的 `dsh-feilian-kb` 时需要重复上述四处本地改动。
- 页面依赖 `flylink.yituobo.com` 上的飞链服务；服务不可达时显示登录错误而不是离线内容。
- 已保存的飞链会话不在租户之间迁移；每个租户登录一次。