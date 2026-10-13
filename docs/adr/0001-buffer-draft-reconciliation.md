# 0001: Reconcile Buffer drafts by stored id, then by unique caption

Status: accepted, 2026-10-13

## Context

Buffer's `createPost` has no idempotency key, and a post has no field the worker can set to a run key. After an ambiguous create (network failure, or a success the worker misread), the next run has to find out whether a draft already exists before it creates one.

The worker previously matched any draft in the channel whose `text` equalled the job's `post_text`. Two Sheet rows with the same `post_text` could therefore adopt each other's draft. A regression test reproduced it: job B adopted job A's draft `draft-of-a`. The test fakes hid the bug, because the fake draft service matched on run key, which the real adapter never did.

## What was verified (Buffer API reference, https://developers.buffer.com/reference.html, read 2026-10-13)

- `posts(after, first, input)` returns `PostsResults { edges, pageInfo }`. `PaginationPageInfo` has `hasNextPage: Boolean!` and `endCursor: String`. The old query read only the first page.
- `PostsFiltersInput` has `channelIds`, `status`, `tagIds`, `tags`, `createdAt`, dates and post types. It has no text search.
- `CreatePostInput` has `tagIds`. `DocumentAsset` (output) has `source`, described as "URL to the file source".
- `Post.externalLink` is a nullable `String`.

## What was not verified

- Whether `DocumentAsset.source` returns the Cloudinary PDF URL we sent or a URL re-hosted by Buffer. Matching on the PDF URL would be unique per run key, but it is not used until one live read-only query confirms it.
- Whether tags can be created through the API. Per-job tags were not adopted.
- A default or maximum page size for `posts`. The worker passes no `first` and follows the cursor.
- Why `buffer_draft_url` is empty in the Sheet. It is filled from `externalLink`, which is nullable. That it is null for unsent drafts is likely, not observed.

## Decision

1. A stored `buffer_draft_id` is authoritative. It is verified with the `post(input: { id })` query.
2. Without a stored id, a job whose trimmed `post_text` equals another row's is stopped as `validation:duplicate_post_text`. This happens before rendering and before any caption lookup, and a human resolves it. The check uses every row in the Sheet, including finished ones.
3. Otherwise the adapter reads every page of channel drafts. Exactly one exact-text match is adopted. More than one is `data_integrity:multiple_matching_drafts` (terminal). The adapter stops with an ambiguous error after 50 pages instead of looping forever.
4. The fake draft service follows the same contract as the real adapter.

## Consequences

- Two queued rows with the same text are both stopped, including the older one. That is deliberate: picking one is a human decision.
- A draft deleted in Buffer after its id was stored is treated as missing, and a new draft is created.
- If several drafts share a caption, for example duplicates from the misread-success bug fixed in 0199033, the worker stops instead of adopting one. Someone has to delete the extras in Buffer and record the kept id in `buffer_draft_id`.
