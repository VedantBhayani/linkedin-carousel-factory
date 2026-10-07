---
title: Cloud Carousel Automation
label: wayfinder:map
tracker: local-markdown
status: open
---

## Destination

An implementation-ready architecture specification for a cloud-native carousel factory that uses ChatGPT scheduled tasks without the OpenAI API, continuously learns from an expanding reference library, renders deterministic carousel assets, preserves searchable state and logs, and creates Buffer drafts automatically.

## Notes

- Use Wayfinder for the decision map, grilling for human decisions, domain modeling for canonical terminology, and research for current third-party capability facts.
- Standing constraints: no OpenAI API; GitHub, Google Drive, Supabase, Cloudinary, Buffer, and their APIs/plugins are permitted; successful output ends as a Buffer draft; failed jobs retry twice and then stop with notification.
- Planning only. The map ends at a reviewed architecture and implementation handoff, not a deployed production system.
- Local Markdown is the tracker because no repository issue tracker integration is configured.

## Decisions so far

- No OpenAI API: ChatGPT scheduled tasks provide editorial and visual reasoning; cloud integrations may use their normal APIs or plugins.
- Publication boundary: successful jobs create Buffer drafts rather than publishing directly.
- Failure boundary: retry twice, preserve diagnostics, then fail closed and notify.
- Reference model: original references are distinct from approved executable styles, layouts, components, and assets.
- V1 observability is deliberately lean: Google Sheets holds current queue/status and concise errors, while GitHub Actions holds verbose execution logs; a separate operational database is deferred.
- [Define the minimal post-understanding contract](tickets/12-content-understanding-contract.md): ChatGPT first creates a compact editorial brief using six post types, then chooses among five curated reference collections before generating carousel JSON.
- [Choose the post and reference intake surfaces](tickets/01-intake-and-trigger.md): the verified V1 intake is Google Sheets for queue/status plus directly listed Google Drive folders for references and generated JSON; polling is used and duplicate filenames must be prevented explicitly.
- [Verify the cloud ChatGPT orchestration boundary](tickets/02-chatgpt-scheduled-task-capabilities.md): cloud scheduled tasks can use connected files/tools/plugins but not a persistent local checkout, so durable handoff must occur through a connected cloud system.
- [Verify rendering and asset-storage contracts](tickets/07-render-and-storage-contract.md): GitHub Actions can run the Playwright renderer and Cloudinary can hold immutable PDFs, images, and raw manifests keyed by a content hash.
- [Verify the Buffer draft integration contract](tickets/08-buffer-draft-contract.md): Buffer can create an unpublished LinkedIn PDF-document draft through its GraphQL API or official MCP connector, but create operations have no idempotency key and require reconciliation before ambiguous retries.
- [Decide how ChatGPT hands jobs to deterministic execution](tickets/03-control-plane-handoff.md): ChatGPT hands off through a `carousel_created` Sheet queue record pointing to immutable Drive JSON; one scheduled GitHub render worker claims at most one row under repository-wide concurrency.
- [Define reference ingestion and retrieval](tickets/04-reference-library-model.md): Drive Reference Sets are analyzed into versioned metadata, approved through a Sheet registry, retrieved from one curated collection without embeddings, and never mutate executable production styles.

## Not yet specified

- Cost ceilings, service-plan limits, and retention periods after the concrete service contracts are verified.
- Whether reference collections eventually need team ownership, permissions, or multi-brand isolation.
- Whether automatic publishing becomes a separate future destination after draft creation is reliable.

## Out of scope

- Direct LinkedIn publishing in this effort; the destination stops at a verified Buffer draft.
- Training or fine-tuning a custom model.
- Calling the OpenAI API from application code.
- Building a public multi-tenant SaaS product in the first implementation.
- A custom dashboard, Supabase control plane, custom MCP server, and visual embeddings in V1; these return only if the lean workflow proves insufficient.
