---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-08-command-conversation-history

[English](2026-11-08-command-conversation-history.md) | 中文

## 概述

为 command/run 记录增加可选的对话活动元数据，使外部任务在没有模型轮次时仍保留在普通对话历史中。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-command-conversation-history
baseline: false
changes:
  - root: "event:command/run"
    previous: "2026-09-11-initial"
    after: "0549e50755807114489d27770e25cd5d019150370391c6e195c68a66d4f22f60"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录省略该标记，保留配置命令原有行为；新读取器将缺失解释为 false。旧读取器保留原有仅日志命令记录并忽略新增元数据，可能继续将纯命令对话视为空白，但不会据此执行任务或授予权限。命令执行和模型历史语义保持原有含义。会话列表投影通过 stateVersion 2 从日志重建空白状态和活跃时间。不更改事件判别字段或写入格式版本。

<a id="verification"></a>
## 验证

commands.spec.ts 的 56 项测试通过，覆盖显式活动标记及普通命令缺省行为。session-presets.host.spec.ts 的 37 项测试通过，覆盖活动、已保存和并发写入后的历史保留。agent.host.spec.ts 与 session-list-blank.host.spec.ts 的定向复测共 17 项全部通过，覆盖冷恢复、活跃时间及普通配置命令原有空白判断。

<a id="dev-note"></a>
## 开发备注

无。
