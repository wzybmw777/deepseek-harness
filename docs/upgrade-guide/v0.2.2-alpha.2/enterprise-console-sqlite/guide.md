---
kind: upgrade-guide
description: "The enterprise console stores administration data in enterprise.sqlite instead of enterprise.json; existing JSON data is not imported."
---

# Enterprise console data moves to `enterprise.sqlite`

English | [中文](guide.zh.md)

## Change

The enterprise console at `dataDir` previously stored its administration catalog in `enterprise.json`. It now stores the catalog, usage, and audit history in `enterprise.sqlite` and does not read `enterprise.json`. A deployment that upgrades with an existing `enterprise.json` starts from a new catalog, writes a new `initial-admin-password.txt`, and cannot access its previous accounts, teams, orders, usage, or audit records.

## Migration

1. Back up `enterprise.json`, `session.key`, and `credential.key` before upgrading.
2. This release has no JSON importer. A deployment that must retain its existing catalog should stay on the previous release or restore the pre-upgrade data directory; otherwise archive `enterprise.json` and continue with a fresh catalog.
3. Start the new release, sign in with the password in `<dataDir>/initial-admin-password.txt`, and change it. Confirm `/enterprise/admin` lists the expected users, teams, and audit records; an empty catalog means the SQLite file was not restored.
