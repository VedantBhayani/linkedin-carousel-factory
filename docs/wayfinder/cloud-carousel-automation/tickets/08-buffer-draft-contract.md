---
title: Verify the Buffer draft integration contract
label: wayfinder:research
status: closed
parent: Cloud Carousel Automation
blocked_by: []
---

## Question

Verify the current supported Buffer integration path for creating a LinkedIn document/carousel draft with caption, PDF or page assets, idempotency protection, and a recoverable external draft identifier.

## Resolution

Buffer's current GraphQL API and official MCP connector can create an unpublished LinkedIn document draft with `saveToDraft: true`. A true document carousel uses one publicly reachable PDF plus a public thumbnail and title; multiple images create an image post rather than the PDF-document format. Buffer hosts no upload endpoint, so Cloudinary URLs must remain stable through publication. Persist the returned Buffer post ID immediately. Buffer exposes no caller idempotency key and no webhooks, so after an ambiguous create response the system must query narrowly for matching draft text/media before retrying.

Sources: [Create a draft post](https://developers.buffer.com/examples/create-draft-post.html), [Hosting media](https://developers.buffer.com/guides/hosting-media.html), [Buffer MCP](https://developers.buffer.com/guides/integrations/mcp.html), [Efficient API usage](https://developers.buffer.com/guides/efficient-api-usage.html).
