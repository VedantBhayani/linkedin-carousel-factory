# Default Purple Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, followed by superpowers:verification-before-completion and superpowers:finishing-a-development-branch.

**Goal:** Make `dark-editorial` Style Package v2 the default, with Helvetica Bold display headings, Griffiths Regular accent copy, and the approved purple color system, without changing unrelated queue or publishing behavior.

**Architecture:** Keep carousel JSON schema v1 and the existing deterministic renderer. `loadEmbeddedFontCss({ fontDir })` validates and embeds the two licensed fonts before a production worker can claim a row. Production passes the prepared CSS into `renderCarousel({ inputPath, distDir, fontCss })`. GitHub Actions reconstructs a private seven-part Base64 ZIP under `$RUNNER_TEMP`; font binaries and encoded derivatives never enter Git.

**Tech Stack:** Node.js 22, native `node:test`, Playwright/Chromium, CSS, GitHub Actions, Google Drive scheduled-task prompt.

**Licensed fixture:** For local tests, use `E:\LInkedin carousell factory fonts\production`, containing exactly `Helvetica-Bold.ttf` and `Griffiths.otf`.

---

### Task 1: Change the carousel style contract

**Files:**
- Modify: `tests/document.test.js`
- Modify: `src/validation.js`
- Modify: `input/carousel.json`
- Modify: `input/launch-video-001-carousel-v1.drive.json`
- Modify: `tests/worker/error-classification.test.js`
- Modify: `tests/worker/job-id-contract.test.js`
- Modify: `tests/worker/run-worker.test.js`

- [ ] Add a document-validation test proving `style.accent: "editorial-purple"` is accepted and `"electric-blue"` is rejected.
- [ ] Run `node --test tests/document.test.js` and confirm the new test fails because the current enum still accepts blue.
- [ ] Change only the supported accent enum in `src/validation.js` and update the exact repository fixtures listed above.
- [ ] Run `node --test tests/document.test.js tests/worker/error-classification.test.js tests/worker/job-id-contract.test.js tests/worker/run-worker.test.js`; expect zero failures.
- [ ] Commit as `feat: adopt editorial purple style contract`.

### Task 2: Version the executable Style Package

**Files:**
- Modify: `tests/worker/manifest.test.js`
- Modify: `src/worker/manifest.js`

- [ ] Add tests proving newly built manifests retain `schemaVersion: 1` and identify `dark-editorial@2`.
- [ ] Add stored-manifest tests proving `dark-editorial@1` and `dark-editorial@2` remain valid for reconciliation, while `@3` and any other style family are rejected.
- [ ] Run `node --test tests/worker/manifest.test.js` and confirm the v2 expectations fail.
- [ ] Implement the minimal current-version/accepted-legacy-version split without changing the manifest schema version.
- [ ] Run `node --test tests/worker/manifest.test.js`; expect zero failures.
- [ ] Commit as `feat: version purple style package`.

### Task 3: Load, validate, and apply the licensed fonts

**Files:**
- Create: `tests/fonts.test.js`
- Modify: `src/fonts.js`
- Modify: `src/render.js`
- Modify: `src/worker/production.js`
- Modify: `tests/worker/production.test.js`
- Modify: `tests/render.test.js`
- Modify: `styles/dark-editorial.css`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add loader tests for exact filenames, aliases, weights/styles, MIME formats (`font/ttf`, `font/otf`), sfnt signatures, and approved SHA-256 hashes.
- [ ] Add negative tests for a missing directory, missing file, extra file, corrupt file, swapped files, and a correctly named file with the wrong hash.
- [ ] Add production-composition tests proving invalid fonts fail as `configuration:invalid_production_font` before a runner is returned or a queue row can be claimed.
- [ ] Add render tests proving the renderer uses only injected private-font CSS, awaits `document.fonts.ready`, checks `700 16px "CarouselHelveticaDisplay"` and `400 16px "CarouselGriffithsAccent"`, and creates no output files when either check fails. This prevents silent system-font fallback.
- [ ] Run `$env:CAROUSEL_FONT_DIR='E:\LInkedin carousell factory fonts\production'; node --test tests/fonts.test.js tests/worker/production.test.js tests/render.test.js` and confirm the expected red failures.
- [ ] Implement `loadEmbeddedFontCss({ fontDir })` with aliases `CarouselHelveticaDisplay` (700 normal) and `CarouselGriffithsAccent` (400 normal). Retain embedded Inter for body/UI copy.
- [ ] Validate and prepare font CSS during production composition, before constructing the worker runner, then inject it through the renderer adapter into `renderCarousel({ inputPath, distDir, fontCss })`.
- [ ] In `renderCarousel`, validate schema, load the page, await fonts, check both exact descriptors, and complete overflow checks before writing HTML, PNG, JPEG, or PDF outputs. Map browser rejection to `configuration:production_font_unavailable`.
- [ ] In the same checkpoint, apply Helvetica only to `.title`, `.hero h1`, `.statement-content h1`, `.comparison-card h2`, and `.closing-content h1`; apply Griffiths only to `.accent`; keep `.list-number` and all other copy on Inter.
- [ ] Remove the unused Lora package and declarations.
- [ ] Add computed-style assertions for the heading, accent, and list-number roles.
- [ ] Run the same focused command; expect zero failures.
- [ ] Commit as `feat: load licensed carousel fonts`.

### Task 4: Apply the purple visual system

**Files:**
- Create: `tests/theme.test.js`
- Modify: `styles/dark-editorial.css`
- Modify: `tests/render.test.js`

- [ ] Add source-level tests for `#420D4A` deep surfaces/glows, `#B84FCC` readable purple text, exact font-role selectors, and absence of electric-blue/Lora declarations.
- [ ] Add a browser assertion that the hero accent computes to `rgb(184, 79, 204)`.
- [ ] Run `$env:CAROUSEL_FONT_DIR='E:\LInkedin carousell factory fonts\production'; node --test tests/theme.test.js tests/render.test.js` and confirm the color expectations fail.
- [ ] Replace the old blue token and hard-coded blue RGBA values with deep, readable-text, and soft purple tokens. Preserve layout and content behavior.
- [ ] Run the same focused command; expect zero failures.
- [ ] Commit as `feat: make purple theme the default`.

### Task 5: Add the minimally changed scheduled-task prompt

**Files:**
- Create: `prompts/carousel-json-builder.v3.md`
- Modify: `prompts/README.md`
- Modify: `README.md`

- [ ] Copy `prompts/carousel-json-builder.v2.md` byte-for-byte to v3.
- [ ] Make only three semantic changes: the JSON template accent becomes `editorial-purple`; the prose style requirement becomes `editorial-purple`; the exact-one-existing-file reuse branch reuses only `editorial-purple`, otherwise sets `needs_human` with `existing carousel file uses the old or invalid style; archive it and reset the row to brief_created`.
- [ ] Run `git diff --no-index --word-diff=porcelain prompts/carousel-json-builder.v2.md prompts/carousel-json-builder.v3.md` and inspect that only those three changes exist.
- [ ] Run `rg -n "electric-blue|editorial-purple" prompts README.md`; expect old blue only in the historical v2 prompt and explicit migration documentation.
- [ ] Update prompt and root README pointers without altering the brief-builder instructions.
- [ ] Commit as `docs: add purple carousel builder prompt`.

### Task 6: Load private fonts in GitHub Actions

**Files:**
- Create: `scripts/verify-production-fonts.mjs`
- Create: `tests/verify-production-fonts.test.js`
- Modify: `.github/workflows/linkedin-carousel-render.yml`
- Modify: `README.md`

- [ ] Add verifier tests for the exact two filenames and hashes, covering missing, extra, corrupt, swapped, and wrong-file cases.
- [ ] Run `node --test tests/verify-production-fonts.test.js` and confirm the expected red failure.
- [ ] Implement a verifier CLI/module that exits nonzero without printing font bytes or secret values.
- [ ] Add one non-preflight workflow setup step with the seven secrets passed through `env`. Create the archive and extraction directory with `mktemp` under `$RUNNER_TEMP`, persist both cleanup paths immediately, concatenate nonempty chunks without `echo`, decode and extract, verify exactly two files, then append `CAROUSEL_FONT_DIR` to `$GITHUB_ENV`.
- [ ] Add a cleanup step guarded by `if: always() && inputs.mode != 'preflight'`. It may remove only the persisted archive/extraction paths after verifying both resolve beneath `$RUNNER_TEMP`, and must still run after setup or worker failure.
- [ ] Keep dispatch inputs, scheduling, concurrency, Google/Cloudinary/Buffer credentials, tests, and worker order unchanged.
- [ ] Run `node --test tests/verify-production-fonts.test.js`; expect zero failures.
- [ ] Commit as `ci: provide licensed carousel fonts`.

### Task 7: Audit and migrate queued blue payloads

**External scope:** Google Sheet `Sheet1` and Drive folder `Carousell Jobs`.

- [ ] Keep worker dispatch paused while auditing.
- [ ] Inventory only rows in `carousel_created`, `render_retry`, or safely reclaimable stale `rendering` whose canonical carousel JSON still contains `electric-blue`.
- [ ] Do not rewrite `render_created`, `draft_retry`, or stale `drafting` rows; valid v1 stored render manifests remain intentionally supported.
- [ ] For each affected pre-render row, archive the old canonical carousel file under a noncanonical name; clear `carousel_file`, `render_manifest`, `worker_id`, `locked_at`, and `error`; reset `render_attempts`; then set status to `brief_created`.
- [ ] Install/activate the v3 JSON-builder prompt, regenerate the canonical carousel JSON, and verify `style.accent` is `editorial-purple` before allowing the worker to run.
- [ ] If the inventory is empty, record the evidence and make no Sheet or Drive writes.

### Task 8: Configure secrets and verify end to end

**Generated files:** Temporary only, outside the checkout.

- [ ] Create a unique temporary directory outside the repository. Copy only `Helvetica-Bold.ttf` and `Griffiths.otf`, ZIP them, Base64-encode the ZIP, and split it into seven chunks no longer than 40,000 characters.
- [ ] Set `CAROUSEL_FONTS_B64_01`…`CAROUSEL_FONTS_B64_07` with `gh secret set NAME < chunk-file` so values never appear in command output or arguments. Verify only the seven secret names with `gh secret list`.
- [ ] Delete the temporary ZIP, Base64, chunk files, and temporary font copies; then verify `git status`, tracked files, and branch history contain no font binaries or encoded derivatives.
- [ ] Run `$env:CAROUSEL_FONT_DIR='E:\LInkedin carousell factory fonts\production'; npm test`; require zero failures.
- [ ] Render into a unique temporary output directory and inspect all eight PNGs for font identity, contrast, wrapping, balance, and clipping.
- [ ] Run `git diff --check`, inspect the full branch diff, and push every implementation commit.
- [ ] Run `gh workflow view linkedin-carousel-render.yml --ref codex/default-purple-theme --yaml` and inspect the server-parsed workflow after the branch is pushed.
- [ ] Dispatch the workflow in `preflight` mode only. Keep normal worker dispatch paused until Task 7 is clean and the branch is merged with JSON-builder v3 installed.

