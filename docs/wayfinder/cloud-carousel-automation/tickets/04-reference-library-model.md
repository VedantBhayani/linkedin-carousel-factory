---
title: Define reference ingestion and retrieval
label: wayfinder:grilling
status: closed
assignee: codex
parent: Cloud Carousel Automation
blocked_by:
  - Choose the post and reference intake surfaces
---

## Question

How are uploaded images and full carousels split, analyzed, tagged, grouped into collections, versioned, and retrieved for a new text post? Decide the V1 boundary between deterministic metadata retrieval and open-source visual embeddings.

## Resolution

V1 uses a curated metadata library in Google Drive plus a `Reference Registry` worksheet. It does not use embeddings, a vector database, or automatic style learning.

### Ingestion unit

The ingestion unit is a **Reference Set**, stored as one folder under `Carousel References`. A standalone image is a one-slide set; a PDF is one ordered set; and a group of numbered images is one ordered set. The original files remain unchanged. Each set receives a stable `reference_id`, and re-analysis creates a new analysis version rather than overwriting an earlier one.

A scheduled ChatGPT task processes at most one unprocessed Reference Set per run. It directly lists the set folder, preserves slide order, analyzes the complete set, and creates `{reference_id}-analysis-v1.json`. The analysis records source files, reference kind, page or slide order, visual motifs, layout patterns, typography category, palette, density, tone, suitable post types, suitable narrative beats, visual treatments, detected brands or logos, proposed collections, and unsupported or risky patterns. Detected logos are descriptive only and never become approved assets automatically.

The task then creates or updates one isolated row in `Reference Registry` with `status = review_needed`, the analysis URL, proposed collections, and analysis version. A human approves the row and may correct collection membership. Only `status = approved` references are eligible for retrieval. No custom dashboard is required.

### Collections and retrieval

A Reference Collection is a curated metadata boundary, not an executable style. Each approved collection has a versioned manifest listing its active Reference Sets and their analysis versions. A reference may belong to more than one collection only through explicit approved registry entries.

For a carousel job, the editorial brief selects one approved collection. Retrieval then filters the collection manifest to approved references compatible with the brief's primary type, tone, narrative beats, and visual needs. It selects at most three Reference Sets using metadata overlap, with stable `reference_id` ordering as the tie-breaker. The selected files are inspected before carousel JSON is written. V1 does not blend collections unless the job explicitly names more than one collection.

The carousel JSON records every selected `reference_id`, analysis version, collection version, and active executable `stylePackage` version. This makes later reproduction and audits possible.

### Safety boundary

References may influence narrative treatments and selection among already-supported layouts or components, but they cannot change renderer code, style tokens, layouts, components, or production assets. When analysis identifies a useful pattern that the active style package cannot express, it creates a style candidate for **Govern styles layouts components and assets**. The current job either falls back to a compatible approved treatment or enters `needs_style`; it never generates unreviewed production code.
