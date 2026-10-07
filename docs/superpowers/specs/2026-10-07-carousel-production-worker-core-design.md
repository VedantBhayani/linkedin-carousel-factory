# Carousel Production Worker Core Design

## Goal

Build a testable Node.js worker under `linkedin-carousel/` that claims at most one eligible carousel job, validates and renders its Drive payload, creates an immutable render manifest, and advances the job toward a Buffer draft without requiring production credentials during development.

## Scope

This design covers the provider-independent worker core, state transitions, retry and stale-lock rules, deterministic identifiers, render orchestration, manifest generation, and fake adapters used by automated tests. It also updates the GitHub Actions workflow so the credential-free worker tests can run manually. Production scheduling is added only after the real provider adapters exist.

Real Google Sheets and Drive access, Cloudinary upload, and Buffer draft creation are separate integration increments. They implement the interfaces defined here after the core behavior passes tests. Dynamic reference retrieval, additional styles, automatic publishing, a dashboard, Supabase, and embeddings remain out of scope.

## Approaches Considered

### Recommended: provider-independent orchestration with injected adapters

The worker owns the state machine and calls small interfaces for the queue, payload store, renderer, asset store, and draft service. Tests use in-memory and filesystem adapters. Production integrations later implement the same interfaces. This keeps business rules testable without network calls or credentials and prevents Google, Cloudinary, or Buffer SDK details from controlling the worker design.

### Single script with direct provider calls

One script could read Sheets, download Drive files, run Playwright, upload to Cloudinary, and call Buffer. This is initially shorter, but every test would require extensive mocking, error recovery would be tangled with provider code, and ambiguous external failures would be difficult to reconcile.

### Separate workflow for every stage

Brief generation, rendering, storage, and Buffer creation could each use independent workflows. This gives strong isolation but creates more schedules, credentials, handoffs, and operational states than the fixed-style V1 needs.

## Architecture

The worker is an application service with five ports:

- `JobQueue`: lists and claims one eligible job, persists state transitions, and records concise errors.
- `PayloadStore`: downloads the carousel JSON referenced by `carousel_file`.
- `CarouselRenderer`: produces and verifies transient HTML, eight PNGs, a cover image, and an eight-page PDF.
- `AssetStore`: reconciles and stores immutable render outputs plus their manifest.
- `DraftService`: reconciles and creates one unpublished Buffer draft.

The worker receives these adapters plus a clock and identifier generator. It does not read environment variables directly. A composition root selects adapters, validates configuration, and invokes one worker run.

The existing Playwright renderer remains the only rendering implementation. It will expose a callable function accepting explicit input and output paths while preserving the command-line entry point.

## Job Contract

The worker consumes a normalized job object:

```json
{
  "jobId": "launch-video-001",
  "rowId": "Sheet1!4",
  "postText": "<complete unmodified source post>",
  "status": "carousel_created",
  "carouselFile": "https://drive.google.com/...",
  "renderAttempts": 0,
  "draftAttempts": 0,
  "lockedAt": "",
  "workerId": "",
  "renderManifest": "",
  "bufferDraftId": "",
  "bufferDraftUrl": "",
  "error": "",
  "updatedAt": "2026-10-07T00:00:00.000Z"
}
```

Provider adapters may map physical Sheet column names to these canonical fields. The worker never changes `job_id`, `post_text`, `brief_file`, or `carousel_file`.

`postText` is the Buffer caption source for V1. It is kept in memory only for the active job, passed to `DraftService`, and never written to logs or diagnostic artifacts.

## State Machine

Eligible states are `carousel_created`, `render_retry`, `render_created`, and `draft_retry`. A stale `rendering` or `drafting` job is also eligible after its lock age exceeds 30 minutes.

Rendering transitions are:

```text
carousel_created | render_retry | stale rendering
  -> rendering
  -> render_created
```

Draft transitions are:

```text
render_created | draft_retry | stale drafting
  -> drafting
  -> draft_created
```

Each run claims at most one job. A render claim increments `renderAttempts`; a draft claim increments `draftAttempts`. The initial attempt plus two retries are allowed. A recoverable render failure becomes `render_retry`; the third failure becomes `render_failed`. A recoverable draft failure becomes `draft_retry`; the third failure becomes `draft_failed`.

The queue adapter must write the claim before the worker reads the payload or performs an external side effect. GitHub Actions additionally uses one repository-wide concurrency group with `cancel-in-progress: false`. Together these rules allow one active worker. They do not claim that Google Sheets provides transactional exactly-once delivery.

## One-Run Behavior

1. Request one eligible job from `JobQueue`.
2. Exit successfully without writes when none exists.
3. Claim the selected stage with a unique `workerId`, current `lockedAt`, and incremented stage attempt. A draft-only job is now already in `drafting` and does not receive another claim in this invocation.
4. For rendering, download the carousel JSON and require the exact filename `{jobId}-carousel-v1.json`.
5. Parse and validate the JSON, and require JSON `jobId` to equal the queue `jobId`.
6. Compute SHA-256 over the original payload bytes. The run key is `{jobId}:{sha256}`.
7. Ask `AssetStore` for an existing verified manifest with that run key.
8. If none exists, render into an isolated job directory, verify every output, build the manifest, and upload with overwrite disabled.
9. Persist `render_created` and the immutable manifest locator before Buffer work begins.
10. When continuing directly from a render completed in this invocation, persist a draft claim by changing the row to `drafting`, assigning the current `workerId`, updating `lockedAt`, and incrementing `draftAttempts`. Skip this step for a draft-only job because step 3 already persisted that claim.
11. Ask `DraftService` for an existing draft associated with the run key.
12. Reuse it when found; otherwise create one unpublished draft from the verified PDF and `postText` caption.
13. Persist `draft_created`, the Buffer draft ID, and the Buffer draft URL.

The worker may complete both stages in one invocation after a fresh render, but the persisted `drafting` claim is mandatory before any Buffer read or write. A run that starts from `render_created`, `draft_retry`, or stale `drafting` uses `AssetStore.loadManifest(renderManifest)` to load and validate the persisted manifest. It obtains the run key and verified PDF locator from that manifest, so it does not download the carousel payload or render again.

## Render Manifest

The manifest is immutable and contains:

```json
{
  "schemaVersion": 1,
  "jobId": "launch-video-001",
  "payloadSha256": "<64 lowercase hex characters>",
  "runKey": "launch-video-001:<sha256>",
  "style": {
    "family": "dark-editorial",
    "version": 1
  },
  "createdAt": "<ISO-8601 timestamp>",
  "files": {
    "pdf": { "name": "carousel.pdf", "sha256": "...", "bytes": 1, "url": "..." },
    "cover": { "name": "cover.jpg", "sha256": "...", "bytes": 1, "url": "..." },
    "slides": [
      { "name": "slide-01.png", "sha256": "...", "bytes": 1, "url": "..." }
    ]
  }
}
```

The manifest requires exactly eight ordered slide entries. Every file must be non-empty and have a SHA-256 digest. The asset adapter assigns URLs; the worker validates the returned manifest before persisting it.

The generated HTML is a transient render input and optional diagnostic file. It is not uploaded to canonical storage and does not appear in the immutable render manifest.

## Idempotency and Reconciliation

The payload hash and `jobId` form the stable run key. Asset paths derive from this run key, and uploads reject overwrites. A retry first looks for an existing complete manifest and reuses it.

The asset adapter writes the manifest last. When a retry finds some expected immutable assets but no valid manifest, it compares each existing asset's stored digest and byte count with the newly rendered file. It reuses an exact match, uploads a missing asset, and raises a terminal asset-conflict error for a mismatch. Only after every expected asset matches does it create the immutable manifest. This permits safe recovery from a process that stopped during upload without permitting overwrite.

Buffer does not provide an idempotency key for draft creation. The draft adapter must reconcile by stored Buffer draft ID first and by run-key metadata or a deterministic marker second. If a create call has an ambiguous result and reconciliation cannot prove whether a draft exists, the worker records a retry state and does not issue another create call during the same run.

## Error Handling

Errors are classified as validation, recoverable external, ambiguous external, or terminal configuration errors.

- Validation errors are terminal for the render stage because the same payload cannot succeed without correction.
- Recoverable external errors consume an attempt and enter the appropriate retry state.
- Ambiguous external errors require reconciliation on the next run before repeating a side effect.
- Missing credentials or invalid production configuration fail before any job is claimed.

The Sheet receives a concise sanitized message with stage and error code. Full stack traces remain in GitHub Actions logs. Tokens, keys, downloaded JSON contents, post text, and signed URLs must not be logged.

Temporary job directories are unique per worker ID. Cleanup happens in a `finally` block and never targets the project root, `input/`, or the shared `dist/` directory.

## Adapter Return Contracts

`PayloadStore.download(carouselFile)` returns `{ fileName, bytes }`. The worker validates `fileName` exactly and hashes the unmodified `bytes` before parsing them as UTF-8 JSON.

`AssetStore.findManifest(runKey)` returns either `null` or a complete validated manifest with its stable locator. `AssetStore.store(renderResult, manifestDraft)` returns the complete manifest plus its locator after immutable upload. `AssetStore.loadManifest(locator)` reloads a persisted manifest for draft-only retries. All three operations must reject incomplete or schema-invalid manifests.

An invalid persisted manifest during a draft-only run is a terminal data-integrity failure. The worker records `draft_failed` with sanitized code `invalid_render_manifest` and performs no Buffer read or write.

`DraftService.findDraft({ runKey, storedDraftId })` returns either `null` or `{ id, url }`. `DraftService.createDraft({ runKey, caption, pdfUrl })` returns `{ id, url }` or throws an explicitly ambiguous error when the provider outcome is unknown.

## GitHub Actions Contract

This core increment keeps `workflow_dispatch`, uses Node 22, installs dependencies and Chromium, and runs the complete credential-free test suite. It does not enable the five-minute production schedule because the real queue, payload, asset, and draft adapters are deliberately separate integration increments.

The final integration increment adds the five-minute schedule, invokes one composed production worker run, and defines a repository-wide `carousel-production-worker` concurrency group with `cancel-in-progress: false`. It receives provider credentials through GitHub encrypted secrets. Pull-request test jobs never receive production secrets and run only unit and filesystem integration tests.

Diagnostic artifacts are uploaded only after a failed render and must not contain the source post, carousel JSON, signed Drive URLs, or credentials. Successful media is stored through `AssetStore`, not GitHub artifacts.

## File Boundaries

- `linkedin-carousel/src/worker/run-worker.js`: one-run orchestration and state transitions.
- `linkedin-carousel/src/worker/job-state.js`: allowed statuses, claims, retry limits, and stale-lock rules.
- `linkedin-carousel/src/worker/manifest.js`: digest calculation and manifest validation.
- `linkedin-carousel/src/worker/errors.js`: typed and sanitized worker errors.
- `linkedin-carousel/src/worker/ports.js`: adapter contract documentation and runtime shape checks.
- `linkedin-carousel/src/worker/main.js`: configuration validation and adapter composition.
- `linkedin-carousel/src/render.js`: callable render function plus existing CLI behavior.
- `linkedin-carousel/tests/worker/*.test.js`: state, orchestration, idempotency, manifest, and failure tests.
- `linkedin-carousel/tests/helpers/fake-adapters.js`: stateful test adapters with recorded calls.
- `.github/workflows/linkedin-carousel-render.yml`: manual credential-free worker tests; production scheduling is added with the real adapters.

Production provider adapters will be added in later focused increments under `linkedin-carousel/src/adapters/`.

## Testing Strategy

Development follows red-green-refactor. Tests cover:

- No eligible job produces no writes or side effects.
- Exactly one eligible job is claimed.
- Claim persistence occurs before payload download.
- Wrong filename or mismatched `jobId` fails without rendering.
- A valid payload renders and creates a complete manifest.
- An existing manifest skips rendering and upload.
- A job with `render_created` skips payload and rendering work.
- Existing Buffer drafts are reused.
- Buffer creation occurs once after reconciliation finds no draft.
- Recoverable failures retry twice and fail on the third attempt.
- Stale locks become eligible after 30 minutes; fresh locks do not.
- Ambiguous draft creation never creates twice in one run.
- Errors written to the queue are sanitized.
- The worker uses `postText` as the draft caption but never mutates, logs, or stores it in diagnostics.
- The worker never mutates source fields or another row.
- Existing renderer unit and browser integration tests continue to pass.

## Success Criteria

- One command runs a credential-free worker test suite locally and in manually dispatched CI.
- One worker invocation processes zero or one jobs.
- Every external side effect occurs only after a persisted claim.
- Repeating the same job and payload reuses the same manifest and Buffer draft.
- Rendering uses isolated input and output paths and preserves existing sample artifacts.
- The initial attempt plus two retries are enforced separately for rendering and drafting.
- Stale jobs can recover without permitting concurrent active workers.
- Logs and queue errors contain no secrets, signed URLs, source posts, or JSON payloads.
- The existing carousel renderer test suite remains green.
