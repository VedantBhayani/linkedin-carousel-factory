---
title: Define the minimal post-understanding contract
label: wayfinder:grilling
status: closed
assignee: codex
parent: Cloud Carousel Automation
blocked_by: []
---

## Question

What is the smallest structured editorial brief ChatGPT must derive from a raw post so it can choose an appropriate narrative, approved reference collection, layouts, and slide count without introducing an overbuilt classification or retrieval system?

## Resolution

V1 uses a compact editorial brief between raw post and carousel JSON. The brief contains one primary post type from six options (contrarian, how-to, framework, story, comparison, or case study), the thesis, audience, tone, ordered narrative beats, required visual treatments, selected approved reference collection, and slide count. ChatGPT chooses from five curated reference collections and inspects only a few representative references. V1 does not require Supabase, embeddings, a custom dashboard, a custom MCP, or automatic production-layout generation. Google Sheets holds queue/status, Google Drive holds source/reference files and generated JSON, GitHub Actions provides detailed execution logs, Cloudinary stores final media, and Buffer receives drafts.
