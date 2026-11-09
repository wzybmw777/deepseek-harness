---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-08-command-conversation-history

English | [中文](2026-11-08-command-conversation-history.zh.md)

## Summary

Adds optional conversation activity metadata to command/run records so external tasks can remain in ordinary conversation history without a model turn.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records omit the flag and preserve configuration-command behavior. New readers interpret absence as false. Older readers retain the log-only command record and ignore the added metadata; they may continue treating command-only chats as blank, but do not execute tasks or grant permissions from it. Command execution and model history semantics are unchanged. Session list projection stateVersion 2 rebuilds cached blankness and recency from the log. No event discriminator or writer format version changes.

<a id="verification"></a>
## Verification

commands.spec.ts passed 56 tests, including opt-in metadata and absence for ordinary commands. session-presets.host.spec.ts passed 37 tests including live, stored, and concurrent-writer history preservation. The focused retry of agent.host.spec.ts and session-list-blank.host.spec.ts passed all 17 tests, including cold resume, recency, and unchanged configuration-command blankness.

<a id="dev-note"></a>
## Dev Note

None.
