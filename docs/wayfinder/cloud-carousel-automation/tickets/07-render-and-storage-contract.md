---
title: Verify rendering and asset-storage contracts
label: wayfinder:research
status: closed
parent: Cloud Carousel Automation
blocked_by: []
---

## Question

Verify the current GitHub Actions and Cloudinary capabilities needed for Playwright rendering, workflow triggering, secret handling, artifact upload, raw manifest storage, deterministic asset paths, and cleanup.

## Resolution

GitHub Actions supports externally dispatched workflows, Playwright Chromium on Ubuntu runners, scoped encrypted secrets, concurrency groups, and short-lived diagnostic artifacts. Dispatch is not exactly-once, so a compact immutable `job_id`, manifest locator, and SHA-256 must be checked against durable state before work begins. Cloudinary supports images, PDFs, and raw JSON manifests. Assets should use content-hash-derived public IDs with `overwrite: false`, and the system must persist returned asset IDs, resource types, public IDs, versions, and secure URLs. GitHub artifacts remain diagnostic rather than canonical storage.

Sources: [GitHub workflow dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch), [Playwright CI](https://playwright.dev/docs/ci), [GitHub secrets](https://docs.github.com/en/actions/concepts/security/secrets), [Cloudinary upload API](https://cloudinary.com/documentation/image_upload_api_reference), [Cloudinary raw uploads](https://cloudinary.com/documentation/upload_parameters#uploading_non_media_files_as_raw_files).
