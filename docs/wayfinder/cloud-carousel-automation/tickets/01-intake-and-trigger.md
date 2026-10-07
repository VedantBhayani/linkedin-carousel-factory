---
title: Choose the post and reference intake surfaces
label: wayfinder:grilling
status: closed
parent: Cloud Carousel Automation
blocked_by: []
---

## Question

Which cloud surfaces are the canonical inboxes for new text posts and new image/PDF carousel references, and should each inbox use event triggers or scheduled polling? Decide between GitHub Issues, Google Drive, Google Sheets, and any supported combination while minimizing integrations and preserving easy human submission.

## Resolution

Google Sheets is the canonical post queue and concise status surface. Google Drive is the canonical store for source/reference files and generated JSON handoff files. The first live test proved that ChatGPT can find and read the queued row, directly list the `Carousell Jobs` folder and reference images, create a JSON file, and update only the intended Sheet cells. Scheduled polling is the V1 trigger because the queue is not a documented native event source. Folder access must use direct listing rather than search, which returned no results in the test. Generated files must use an immutable job/version name or explicit existing-file lookup because Drive allowed a second `test-001.json` with the same visible name.
