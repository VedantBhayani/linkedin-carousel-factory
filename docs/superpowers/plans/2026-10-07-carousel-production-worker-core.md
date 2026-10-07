# Carousel Production Worker Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the provider-independent one-job carousel worker core, including state claims, isolated rendering, immutable manifests, retries, reconciliation, and Buffer-draft orchestration without production credentials.

**Architecture:** A small application service receives injected queue, payload, renderer, asset, and draft adapters. The worker owns state transitions and idempotency while provider adapters own external I/O. Tests use stateful fake adapters and the real filesystem renderer, so all production rules are proven before Google, Cloudinary, and Buffer integrations are added.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, Playwright renderer, `node:crypto`, GitHub Actions.

**Specification:** `docs/superpowers/specs/2026-10-07-carousel-production-worker-core-design.md`

---

## File map

- Modify `linkedin-carousel/src/render.js`: export `renderCarousel({ inputPath, distDir })` and keep direct CLI execution.
- Create `linkedin-carousel/src/worker/job-state.js`: statuses, eligibility, claims, retry limits, and stale-lock rules.
- Create `linkedin-carousel/src/worker/errors.js`: typed worker errors and safe queue messages.
- Create `linkedin-carousel/src/worker/ports.js`: runtime adapter shape checks.
- Create `linkedin-carousel/src/worker/manifest.js`: SHA-256 helpers, manifest draft creation, and validation.
- Create `linkedin-carousel/src/worker/run-worker.js`: one-run orchestration.
- Create `linkedin-carousel/src/worker/main.js`: dependency validation and one-run entry function; no provider credentials yet.
- Create `linkedin-carousel/tests/worker/job-state.test.js`: state and stale-lock tests.
- Create `linkedin-carousel/tests/worker/errors.test.js`: sanitization tests.
- Create `linkedin-carousel/tests/worker/manifest.test.js`: manifest and digest tests.
- Create `linkedin-carousel/tests/helpers/fake-adapters.js`: stateful queue, payload, renderer, asset, and draft fakes.
- Create `linkedin-carousel/tests/worker/run-worker.test.js`: orchestration, order, retries, and idempotency tests.
- Create `linkedin-carousel/tests/worker/render-worker.integration.test.js`: real renderer isolation test.
- Create `linkedin-carousel/tests/worker/main.test.js`: composition-root validation tests.
- Modify `linkedin-carousel/package.json`: focused worker scripts.
- Modify `.github/workflows/linkedin-carousel-render.yml`: manual credential-free core verification only.
- Modify `linkedin-carousel/README.md`: worker-core commands and explicit integration boundary.

---

### Task 1: Make the renderer callable with isolated paths

**Files:**
- Modify: `linkedin-carousel/src/render.js`
- Test: `linkedin-carousel/tests/render.test.js`

- [ ] **Step 1: Write a failing isolated-path test**

Add a test that creates a temporary directory with `fs.mkdtempSync`, invokes the desired `renderCarousel({ inputPath, distDir })` API with the approved fixture, and asserts that all output appears only in the supplied directory. Assert that `linkedin-carousel/dist/` is not modified by comparing its file modification timestamps before and after.

```js
import { renderCarousel } from "../src/render.js";

test("renders into explicit isolated paths", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-render-"));
  const output = path.join(temp, "output");
  const before = snapshotStats(dist);
  await renderCarousel({ inputPath: fixturePath, distDir: output });
  assert.deepEqual(listOutputs(output), expectedOutputs);
  assert.deepEqual(snapshotStats(dist), before);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --test-name-pattern="renders into explicit isolated paths"`

Expected: FAIL because `renderCarousel` is not exported.

- [ ] **Step 3: Extract the callable renderer**

Change `src/render.js` so the existing body becomes:

```js
export async function renderCarousel({ inputPath, distDir }) {
  // Existing parse, validation, browser rendering, clipping checks, and exports.
  return {
    html: path.join(distDir, "carousel.html"),
    pdf: path.join(distDir, "carousel.pdf"),
    cover: path.join(distDir, "cover.jpg"),
    slides: Array.from({ length: 8 }, (_, index) =>
      path.join(distDir, `slide-${String(index + 1).padStart(2, "0")}.png`))
  };
}
```

Keep CLI defaults from `CAROUSEL_INPUT`, `CAROUSEL_DIST`, or the current repository paths. Guard CLI invocation by comparing `import.meta.url` with `pathToFileURL(process.argv[1]).href`.

- [ ] **Step 4: Run focused and full renderer tests**

Run: `npm run test:integration`

Expected: PASS, including the new isolated-path test.

Run: `npm test`

Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/src/render.js linkedin-carousel/tests/render.test.js
git commit -m "refactor: expose isolated carousel renderer"
```

---

### Task 2: Define worker states, claims, and stale-lock eligibility

**Files:**
- Create: `linkedin-carousel/src/worker/job-state.js`
- Create: `linkedin-carousel/tests/worker/job-state.test.js`

- [ ] **Step 1: Write failing state tests**

Cover these cases separately:

```js
assert.equal(stageFor({ status: "carousel_created" }), "render");
assert.equal(stageFor({ status: "render_created" }), "draft");
assert.equal(stageFor({ status: "rendering", lockedAt: recent }), null);
assert.equal(stageFor({ status: "rendering", lockedAt: stale }), "render");
assert.deepEqual(claimJob(renderJob, now, "worker-1"), {
  ...renderJob,
  status: "rendering",
  renderAttempts: renderJob.renderAttempts + 1,
  lockedAt: now,
  workerId: "worker-1",
  error: ""
});
```

Also test draft claims, exactly 30-minute boundary behavior, two retries plus the initial attempt, terminal statuses, malformed timestamps, and source-field preservation.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/job-state.test.js`

Expected: FAIL because `job-state.js` does not exist.

- [ ] **Step 3: Implement the minimal state model**

Export:

```js
export const MAX_STAGE_ATTEMPTS = 3;
export const STALE_LOCK_MS = 30 * 60 * 1000;
export function stageFor(job, now = new Date()) {}
export function claimJob(job, stage, now, workerId) {}
export function failureTransition(job, stage, safeError) {}
```

`stageFor` accepts `carousel_created`, `render_retry`, `render_created`, `draft_retry`, and stale `rendering` or `drafting`. It rejects fresh locks, completed jobs, terminal failures, unknown statuses, and exhausted attempts.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/worker/job-state.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/src/worker/job-state.js linkedin-carousel/tests/worker/job-state.test.js
git commit -m "feat: define carousel worker state machine"
```

---

### Task 3: Add typed errors and sanitization

**Files:**
- Create: `linkedin-carousel/src/worker/errors.js`
- Create: `linkedin-carousel/tests/worker/errors.test.js`

- [ ] **Step 1: Write failing sanitization tests**

Test validation, recoverable, ambiguous, configuration, asset-conflict, and data-integrity errors. Include messages containing a signed URL, JSON payload, multiline stack text, and an overlong provider response.

```js
const safe = toSafeQueueError(new WorkerError("external", "drive_timeout", secretMessage));
assert.equal(safe.code, "drive_timeout");
assert.ok(!safe.message.includes("https://"));
assert.ok(safe.message.length <= 240);
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/errors.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement error types**

Export `WorkerError`, `AmbiguousExternalError`, and `toSafeQueueError`. Safe messages contain only the stage, stable error code, and a short generic description. They never include provider URLs, tokens, post text, JSON bodies, or stack traces.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/worker/errors.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/src/worker/errors.js linkedin-carousel/tests/worker/errors.test.js
git commit -m "feat: add safe worker error model"
```

---

### Task 4: Build and validate immutable render manifests

**Files:**
- Create: `linkedin-carousel/src/worker/manifest.js`
- Create: `linkedin-carousel/tests/worker/manifest.test.js`

- [ ] **Step 1: Write failing manifest tests**

Use small temporary files. Test byte-accurate SHA-256, stable payload run keys, exactly eight ordered slides, non-empty file requirements, lowercase 64-character hashes, style version, URL assignment, and rejection of incomplete or malformed persisted manifests.

```js
const runKey = createRunKey("job-1", Buffer.from("payload"));
assert.match(runKey, /^job-1:[a-f0-9]{64}$/);

const draft = await createManifestDraft({ jobId: "job-1", payloadBytes, outputs, now });
assert.equal(draft.files.slides.length, 8);
validateStoredManifest(withUrls(draft));
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/manifest.test.js`

Expected: FAIL because the manifest module does not exist.

- [ ] **Step 3: Implement manifest helpers**

Export:

```js
export function sha256Bytes(bytes) {}
export function createRunKey(jobId, payloadBytes) {}
export async function createManifestDraft({ jobId, payloadBytes, outputs, now }) {}
export function validateStoredManifest(manifest) {}
```

Do not include source post text, signed Drive URLs, or generated HTML in the manifest.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/worker/manifest.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/src/worker/manifest.js linkedin-carousel/tests/worker/manifest.test.js
git commit -m "feat: create immutable render manifests"
```

---

### Task 5: Define adapter contracts and stateful fakes

**Files:**
- Create: `linkedin-carousel/src/worker/ports.js`
- Create: `linkedin-carousel/tests/helpers/fake-adapters.js`
- Create: `linkedin-carousel/tests/worker/ports.test.js`

- [ ] **Step 1: Write failing port-validation tests**

Assert that the worker rejects missing methods before claiming a job. Required methods are:

```text
JobQueue: findEligible, persistClaim, persistState
PayloadStore: download
CarouselRenderer: render
AssetStore: findManifest, store, loadManifest
DraftService: findDraft, createDraft
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/ports.test.js`

Expected: FAIL because ports and fakes do not exist.

- [ ] **Step 3: Implement runtime shape checks and fakes**

`assertWorkerPorts(ports)` reports the exact missing port and method. Fakes store jobs, payloads, manifests, drafts, recorded calls, and injected failures. The fake queue only updates the target `rowId` and throws if a worker attempts to change immutable source fields.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/worker/ports.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/src/worker/ports.js linkedin-carousel/tests/helpers/fake-adapters.js linkedin-carousel/tests/worker/ports.test.js
git commit -m "test: add worker adapter contracts and fakes"
```

---

### Task 6: Orchestrate no-job, claim, validation, and render success

**Files:**
- Create: `linkedin-carousel/src/worker/run-worker.js`
- Create: `linkedin-carousel/tests/worker/run-worker.test.js`

- [ ] **Step 1: Write a failing no-job test**

Assert the result is `{ outcome: "idle" }` and every adapter has zero write or side-effect calls.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/run-worker.test.js --test-name-pattern="idle"`

Expected: FAIL because `runWorker` does not exist.

- [ ] **Step 3: Implement idle behavior only**

Create `runWorker({ ports, clock, createWorkerId })`. Validate ports, call `findEligible`, and return idle when no job exists.

- [ ] **Step 4: Run and verify GREEN**

Run the same command. Expected: PASS.

- [ ] **Step 5: Write failing claim-order and payload-validation tests**

Test that `persistClaim` occurs before `download`; only one job is selected; the filename must be exactly `{jobId}-carousel-v1.json`; parsed JSON `jobId` must match; invalid UTF-8/JSON/schema never calls the renderer; and the queue receives a terminal sanitized render failure.

- [ ] **Step 6: Run and verify RED**

Run: `node --test tests/worker/run-worker.test.js`

Expected: new tests FAIL after the claim because orchestration is incomplete.

- [ ] **Step 7: Implement claim and validation flow**

Persist the claim, download `{ fileName, bytes }`, validate identity, reuse the existing carousel validator, create the run key, and map validation errors to `render_failed` without retry.

- [ ] **Step 8: Write failing render-success test**

Assert event order:

```text
findEligible -> persistClaim -> download -> findManifest -> render -> store -> persist render_created
```

Assert the renderer receives unique input and output paths under a temporary worker directory and cleanup occurs after completion.

- [ ] **Step 9: Implement minimal render-success flow**

Write the original payload bytes to the isolated input file, call the renderer, create the manifest draft, store it, validate the returned manifest, and persist `render_created` with its locator.

- [ ] **Step 10: Run tests and verify GREEN**

Run: `node --test tests/worker/run-worker.test.js`

Expected: all current orchestration tests PASS.

- [ ] **Step 11: Commit**

```bash
git add linkedin-carousel/src/worker/run-worker.js linkedin-carousel/tests/worker/run-worker.test.js
git commit -m "feat: orchestrate claimed carousel renders"
```

---

### Task 7: Add manifest reuse and partial-upload recovery

**Files:**
- Modify: `linkedin-carousel/src/worker/run-worker.js`
- Modify: `linkedin-carousel/tests/helpers/fake-adapters.js`
- Modify: `linkedin-carousel/tests/worker/run-worker.test.js`

- [ ] **Step 1: Write failing idempotency tests**

Cover:

- A complete existing manifest skips renderer and upload.
- Partial assets with matching digest and size are reused.
- Missing partial assets are uploaded.
- A partial asset with a conflicting digest causes terminal `render_failed` with `asset_conflict`.
- The immutable manifest is written after all media assets.
- Repeating the same payload returns the same run key.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/run-worker.test.js --test-name-pattern="manifest|partial|conflict"`

Expected: FAIL because reconciliation behavior is incomplete.

- [ ] **Step 3: Implement reconciliation through `AssetStore`**

Keep provider details outside the worker. Require `store` to reconcile each expected asset by digest and write the manifest last. Convert conflicts to terminal render failure; treat recoverable upload failures with the retry policy.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same focused command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/src/worker/run-worker.js linkedin-carousel/tests/helpers/fake-adapters.js linkedin-carousel/tests/worker/run-worker.test.js
git commit -m "feat: reconcile immutable render assets"
```

---

### Task 8: Add draft claiming, reconciliation, and creation

**Files:**
- Modify: `linkedin-carousel/src/worker/run-worker.js`
- Modify: `linkedin-carousel/tests/helpers/fake-adapters.js`
- Modify: `linkedin-carousel/tests/worker/run-worker.test.js`

- [ ] **Step 1: Write failing draft tests**

Cover:

- Fresh render persists `render_created`, then a separate `drafting` claim, before any Buffer call.
- Draft-only jobs claim once and do not increment twice.
- Draft-only jobs load the manifest by locator without downloading or rendering.
- Invalid stored manifests become terminal `draft_failed` with `invalid_render_manifest` and no Buffer call.
- Stored draft IDs are reconciled first.
- Existing drafts are reused.
- Missing drafts are created once with the exact unmodified `postText` and verified PDF URL.
- Ambiguous creation enters `draft_retry` and does not issue a second create call in the same run.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/run-worker.test.js --test-name-pattern="draft|Buffer|manifest"`

Expected: FAIL because draft flow is absent.

- [ ] **Step 3: Implement draft flow**

For fresh renders, persist the draft claim after `render_created`. For draft-only jobs, use the claim made at the beginning. Load and validate the stored manifest when necessary. Reconcile, optionally create, and persist `draft_created` with only draft ID and URL.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same focused command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/src/worker/run-worker.js linkedin-carousel/tests/helpers/fake-adapters.js linkedin-carousel/tests/worker/run-worker.test.js
git commit -m "feat: reconcile and create Buffer drafts"
```

---

### Task 9: Enforce retries and stale-lock recovery

**Files:**
- Modify: `linkedin-carousel/src/worker/run-worker.js`
- Modify: `linkedin-carousel/tests/worker/run-worker.test.js`

- [ ] **Step 1: Write failing retry tests**

Test render and draft stages independently:

- Attempt one failure becomes the stage retry status.
- Attempt two failure remains retryable.
- Attempt three failure becomes the terminal stage failure.
- A stale render lock is reclaimed as one new render attempt.
- A stale draft lock is reclaimed as one new draft attempt.
- Fresh locks produce idle behavior.
- Configuration failure occurs before claim.
- Errors are sanitized and only the selected row changes.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/run-worker.test.js --test-name-pattern="retry|stale|configuration"`

Expected: FAIL because failure transitions are incomplete.

- [ ] **Step 3: Implement minimal retry mapping**

Use `failureTransition` from `job-state.js`. Validation, asset conflict, and invalid stored manifest errors are terminal immediately. Recoverable and ambiguous external errors use retry states until the stage attempt reaches three.

- [ ] **Step 4: Run focused and complete worker tests**

Run: `node --test tests/worker/*.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/src/worker/run-worker.js linkedin-carousel/tests/worker/run-worker.test.js
git commit -m "feat: recover and retry carousel jobs"
```

---

### Task 10: Prove orchestration with the real renderer

**Files:**
- Create: `linkedin-carousel/tests/worker/render-worker.integration.test.js`
- Modify: `linkedin-carousel/tests/helpers/fake-adapters.js`

- [ ] **Step 1: Write the real-render integration test**

Use the Drive-generated fixture at `input/launch-video-001-carousel-v1.drive.json`, fake queue/payload/asset/draft adapters, and the real `renderCarousel`. Assert final `draft_created`, one manifest, eight slide entries, valid PDF/cover URLs from the fake asset store, one draft, isolated cleanup, and no modification of shared `input/carousel.json` or `dist/`. Load the generated PDF with `pdf-lib` and assert that it contains exactly eight pages.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/render-worker.integration.test.js`

Expected: FAIL until the renderer adapter and worker result shapes agree.

- [ ] **Step 3: Add the minimal renderer adapter wrapper**

Wrap `renderCarousel` as `{ render: options => renderCarousel(options) }` in the test helper or composition root. Do not duplicate rendering logic.

- [ ] **Step 4: Run and verify GREEN**

Run the same command. Expected: PASS with one real eight-slide render.

- [ ] **Step 5: Commit**

```bash
git add linkedin-carousel/tests/worker/render-worker.integration.test.js linkedin-carousel/tests/helpers/fake-adapters.js
git commit -m "test: verify worker with real carousel renderer"
```

---

### Task 11: Add the credential-free entry point and CI verification

**Files:**
- Create: `linkedin-carousel/src/worker/main.js`
- Modify: `linkedin-carousel/package.json`
- Modify: `.github/workflows/linkedin-carousel-render.yml`
- Modify: `linkedin-carousel/README.md`
- Test: `linkedin-carousel/tests/worker/main.test.js`

- [ ] **Step 1: Write failing composition tests**

Assert `createWorkerRunner` rejects missing ports before claim and invokes `runWorker` when all ports exist. Do not add environment-variable or credential parsing yet.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worker/main.test.js`

Expected: FAIL because `main.js` does not exist.

- [ ] **Step 3: Implement the composition entry**

Export `createWorkerRunner({ ports, clock, createWorkerId })`. Add scripts:

```json
{
  "test": "node --test tests/*.test.js tests/worker/*.test.js",
  "test:worker": "node --test tests/worker/*.test.js",
  "test:worker-integration": "node --test tests/worker/render-worker.integration.test.js"
}
```

Update the manual GitHub workflow to run `npm test`. Remove the existing unconditional successful-output `actions/upload-artifact` step. This increment does not upload successful media to GitHub artifacts; later production media goes through `AssetStore`, and a future integration may add sanitized diagnostics only on failure. Do not add the schedule or production secrets in this increment. Document that production adapters are the next implementation stage.

- [ ] **Step 4: Run full verification**

Run: `npm test`

Expected: all renderer and worker tests PASS with zero failures.

Run: `npm run render`

Expected: the default sample render completes successfully.

- [ ] **Step 5: Inspect repository changes**

Run: `git status --short` and `git diff --check`.

Expected: only planned carousel worker, renderer, workflow, test, README, and plan files are changed; no generated output, credentials, unrelated lead-triage files, or user data are staged.

- [ ] **Step 6: Commit**

```bash
git add linkedin-carousel/src/worker linkedin-carousel/tests/worker linkedin-carousel/tests/helpers linkedin-carousel/src/render.js linkedin-carousel/tests/render.test.js linkedin-carousel/package.json linkedin-carousel/package-lock.json linkedin-carousel/README.md .github/workflows/linkedin-carousel-render.yml
git commit -m "feat: add credential-free carousel production worker core"
```

---

## Completion boundary

This plan completes the credential-free production worker core. It does not claim that the cloud pipeline is deployed. The next focused plans add, in order:

1. Google Sheets queue and Drive payload adapters.
2. Cloudinary immutable asset adapter.
3. Buffer draft adapter and reconciliation against the real account.
4. GitHub encrypted-secret configuration and five-minute production schedule.
5. Staging soak tests and activation.
