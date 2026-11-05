---
kind: upgrade-guide
description: "企业控制台的管理数据从 enterprise.json 改为 enterprise.sqlite；现有 JSON 数据不会被导入。"
---

# 企业控制台数据迁移到 `enterprise.sqlite`

[English](guide.md) | 中文

## 变更

企业控制台的 `dataDir` 之前使用 `enterprise.json` 保存管理目录。现在目录、用量和审计历史保存在 `enterprise.sqlite`，不再读取 `enterprise.json`。带旧 `enterprise.json` 升级的部署会从新目录开始，重新写入 `initial-admin-password.txt`，并且无法访问原有的账号、团队、订单、用量和审计记录。

## 迁移

1. 升级前备份 `enterprise.json`、`session.key` 和 `credential.key`。
2. 本版本没有 JSON 导入器。必须保留现有目录的部署应继续使用旧版本，或恢复升级前的数据目录；否则归档 `enterprise.json` 并使用全新目录。
3. 启动新版本，使用 `<dataDir>/initial-admin-password.txt` 中的密码登录并修改密码。确认 `/enterprise/admin` 列出了预期的用户、团队和审计记录；目录为空说明 SQLite 文件没有被恢复。
