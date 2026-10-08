# Cloudinary Raw Public IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cloudinary raw PDF and JSON assets retrievable across worker invocations by preserving filename extensions in their public IDs.

**Architecture:** Keep the asset-store interface and Sheet locator unchanged. Change only public-ID construction: raw assets retain filenames, while image assets retain basename-only IDs. Lock this down with adapter tests, then recover and verify `live-001`.

**Tech Stack:** Node.js 22, node:test, Cloudinary Node SDK, Google Sheets, GitHub Actions.

---

### Task 1: Add the regression test

**Files:**
- Modify: `tests/adapters/cloudinary-assets.test.js:115-130`
- Modify: `tests/adapters/cloudinary-assets.test.js:194-208`

- [ ] Add assertions that the object map contains `carousel.pdf`, `carousel-manifest.json`, extensionless `cover`, and extensionless `slide-01` under the run-key prefix.
- [ ] Assert manifest reload queries the exact `.json` public ID.
- [ ] Run `node --test tests/adapters/cloudinary-assets.test.js` and verify it fails because raw IDs are currently extensionless.

### Task 2: Implement the minimal adapter fix

**Files:**
- Modify: `src/adapters/cloudinary-assets.js:30-38`
- Test: `tests/adapters/cloudinary-assets.test.js`

- [ ] In `assetPublicId`, use the full filename when `resourceTypeOf(fileName) === "raw"`; otherwise use `baseNameOf(fileName)`.
- [ ] Change `manifestPublicId` to end in `carousel-manifest.json`.
- [ ] Run `node --test tests/adapters/cloudinary-assets.test.js` and verify all focused tests pass.
- [ ] Run `npm test` and verify zero failures.
- [ ] Commit with `fix: preserve Cloudinary raw extensions`.

### Task 3: Review, push, and recover production

**Files and state:**
- Verify: `src/adapters/cloudinary-assets.js`
- Verify: `tests/adapters/cloudinary-assets.test.js`
- External state: Google Sheet `Sheet1!A6:M6`

- [ ] Inspect `git diff HEAD~1 --check` and the implementation diff; only public-ID behavior and its tests may change.
- [ ] Push `master` and verify local HEAD equals `origin/master`.
- [ ] Set `Sheet1!C6=render_retry`, `F6=2`, `G6=0`, and clear `M6`, preserving all other cells and formatting.
- [ ] Dispatch `Render LinkedIn Carousel` once and inspect the production-worker log.
- [ ] Branch on the first production outcome: if it is `draft_created`, do not dispatch again; if it is `draft_retry`, dispatch one draft-only retry without resetting or rerendering, and verify that invocation retrieves the manifest by durable locator.
- [ ] Final completion requires `status=draft_created`, non-empty Buffer ID and URL, blank error, and worker `outcome=draft_created`. Verify the stored locator matches the production run key and that Cloudinary delivery returns HTTP 200 for `carousel.pdf`, `carousel-manifest.json`, the cover, and all eight slide images.