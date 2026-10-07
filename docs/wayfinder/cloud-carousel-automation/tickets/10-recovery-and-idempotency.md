---
title: Define retries recovery and duplicate prevention
label: wayfinder:grilling
status: open
parent: Cloud Carousel Automation
blocked_by:
  - Decide how ChatGPT hands jobs to deterministic execution
  - Define durable state logs and retention
  - Verify rendering and asset-storage contracts
  - Verify the Buffer draft integration contract
---

## Question

What state machine, checksums, leases, retry rules, compensating actions, and reconciliation jobs guarantee that a repeated schedule or partial failure cannot create duplicate assets or Buffer drafts?
