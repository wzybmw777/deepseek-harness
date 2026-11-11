# Agent hub bundle

The enterprise console owns product storage, billing, and tenant policy. This bundle owns two things instead: the workbench surfaces every tenant renders, and the first-party catalog those surfaces present.

## Surfaces

`cordis.patch.yml` inserts `@deepseek-ai/dsh-client-ui-enterprise-resources` under the stable id `enterprise-resources-ui`. Tenant startup therefore no longer hard-codes that package path; the enterprise plugin policy decides whether the insert exists at all.

## Catalog seed

`catalog/agents.json` lists the first-party agents with their task descriptions, required materials, deliverables, examples, and prompts. When the console opens product storage it compares the content hash with the hash recorded for the previous seed. On a change it inserts every catalog id the store does not yet hold, as a draft, and records the new hash. Entries an owner edited or deleted are never rewritten.

## Failure behavior

If the catalog file is missing or malformed, the console logs nothing model-facing and simply keeps operating with whatever the store already holds; seeding never blocks startup.
