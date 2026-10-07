---
title: Decide how ChatGPT hands jobs to deterministic execution
label: wayfinder:grilling
status: closed
assignee: codex
parent: Cloud Carousel Automation
blocked_by:
  - Choose the post and reference intake surfaces
  - Verify the cloud ChatGPT orchestration boundary
---

## Question

What durable handoff should ChatGPT create after producing carousel JSON so GitHub Actions can render exactly once: a commit, pull request, issue attachment, workflow dispatch, or queue record?

## Resolution

Use the existing Google Sheet row as the durable queue record and the immutable Google Drive carousel JSON as its payload. After ChatGPT validates and creates or reuses the exact `{job_id}-carousel-v1.json` file, it updates only that job row to `status = carousel_created` and writes the Drive URL to `carousel_file`. That completed state transition is the handoff; ChatGPT does not commit job data, open a pull request, or dispatch GitHub directly.

A single GitHub Actions render worker polls on a five-minute schedule and also supports manual dispatch. GitHub concurrency must use one repository-wide render-worker group with `cancel-in-progress: false`, so only one workflow claims from the Sheet at a time. Each run processes at most one eligible row. It writes `status = rendering`, a unique `render_attempt_id`, and `render_started_at` before downloading the payload. A run that finds no `carousel_created` row exits successfully without writes.

The worker verifies that the Drive filename, JSON `jobId`, and Sheet `job_id` agree before rendering. Repository commits contain renderer code, approved styles, layouts, tests, and workflow definitions only; per-job JSON and rendered media remain outside Git. Canonical rendered assets and their immutable manifest are stored under deterministic job/version identifiers, while GitHub artifacts are retained only for diagnostics.

Google Sheets does not provide a transactional compare-and-set queue, so this contract provides one active renderer through GitHub concurrency rather than claiming theoretical exactly-once delivery. Duplicate prevention for crashed or ambiguous attempts is handled by deterministic identifiers, stored attempt data, and reconciliation in **Define retries recovery and duplicate prevention**.
