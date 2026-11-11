---
description: "Ship the enterprise agent hub and its first-party agent catalog as a built-in plugin."
kind: "package-bundle"
---

# @deepseek-ai/dsh-agent-hub-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes the team resource workbench surfaces the enterprise console renders and ships the first-party agent catalog as data. Enterprise owners find it under Plugins as a built-in entry, switched on by default. Disabling it removes the workbench surfaces for every tenant; the product catalog stored by the console is left untouched.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open Plugins in the enterprise console and find 智能体中心 in the built-in group, marked by a hub icon. It arrives enabled, so a new tenant starts with the file, knowledge, skill, and agent panels plus the seeded agent catalog. Switching it off stops the console from projecting the surfaces into tenant profiles; tenants keep whatever catalog entries and product history they already have.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer information — click to expand</summary>

`cordis.patch.yml` mounts `@deepseek-ai/dsh-client-ui-enterprise-resources` for the tenant workbench, replacing the absolute-path insert the tenant runtime used to write on its own. `catalog/agents.json` carries the first-party business advisors, `catalog/experts.json` the imported expert personas, and `catalog/teams.json` the expert teams; the enterprise console reads all three next to its own package, seeds missing entries with their declared publish state when the content changes, and never overwrites an entry an owner edited. The workbench exposes them as Featured, Experts, and Teams. Neither half starts a model request by itself.

</details>

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the console's product runtime, which renders an agent's stored system prompt and skill whenever a user runs it; the bundle itself ships only catalog data and workbench pages.

#### KV Cache effect

No direct effect; each product run owns its own prompt.

## Known Limitations and Deferred Work

- The bundle ships one catalog revision. Entries the owner deletes stay deleted until the shipped catalog changes, at which point only newly added ids are inserted again.
- Enabling the bundle on an existing installation requires the tenant to restart before the workbench surfaces appear.
