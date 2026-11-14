---
description: "将企业智能体中心与其第一方智能体目录作为内置插件发布。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-agent-hub-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 组合企业控制台渲染的团队资源工作台界面，并随包发布第一方智能体目录数据。企业所有者在插件管理的内置分组中看到它，且默认开启。关闭后所有租户的资源工作台界面都会移除，控制台中已保存的产品目录保持不变。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在企业控制台打开插件管理，在内置分组中找到带枢纽图标的“智能体中心”。它默认开启，新租户开箱即带文件、知识、技能与智能体面板，以及已种入的智能体目录。关闭后控制台不再把界面写入租户 Profile；租户已有的目录条目与产品历史保持不变。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`cordis.patch.yml` 为租户工作台挂载 `@deepseek-ai/dsh-client-ui-enterprise-resources`，替代此前由租户运行时自行写入的绝对路径条目。`catalog/agents.json` 保存第一方企业经营参谋，`catalog/experts.json` 保存导入的专家人格，`catalog/teams.json` 保存专家团；企业控制台从自身包旁读取这三份目录，在内容变化时把缺失条目按各自的发布状态种入，且不会覆盖管理员编辑过的条目。工作台以“精选 / 专家 / 专家团”三个入口呈现它们。两部分本身都不会发起模型请求。

</details>

-----

<a id="model-experience"></a>
## 模型体验

间接。Bundle 提供展示数据与工作台页面；用户运行某个智能体时，由控制台的产品运行时渲染该智能体已保存的系统提示与技能，与管理员手工创建的智能体完全一致。

#### KV Cache 影响

无直接影响；每次产品运行拥有自己的提示。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- Bundle 只携带一个目录版本。管理员删除的条目不会自动恢复，直到随包目录发生变化，此时只会重新插入新增的标识。
- 在已有部署中启用该 Bundle 后，需要重启租户才会出现资源工作台界面。
