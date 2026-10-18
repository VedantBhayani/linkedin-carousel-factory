# Default Purple Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `dark-editorial` Style Package v2 the default, with Helvetica Bold display headings, Griffiths Regular accent copy, and the approved purple color system.

**Architecture:** Keep carousel JSON schema v1 and the existing deterministic renderer. Load and hash-check the two licensed fonts from `CAROUSEL_FONT_DIR`, prepare their embedded CSS before a production worker can claim a row, and pass that CSS through the renderer adapter. GitHub Actions reconstructs a private seven-part Base64 ZIP from repository secrets into a temporary directory; font binaries never enter Git.

**Tech Stack:** Node.js 22, native `node:test`, Playwright/Chromium, CSS, GitHub Actions, Google Drive scheduled-task prompt.

---

### Task 1: Change the carousel style contract

**Files:**
- Modify: `tests/document.test.js`
- Modify: `src/validation.js`
- Modify: `input/carousel.json`
- Modify: `input/launch-video-001-carousel-v1.drive.json`
- Modify: affected worker fixtures under `tests/`

- [ ] Add tests proving `editorial-purple` is accepted and `electric-blue` is rejected.
- [ ] Run the focused tests and confirm the expected red failure.
- [ ] Change the one supported accent enum and update repository fixtures.
- [ ] Run the focused tests and confirm green.
- [ ] Commit as `feat: adopt editorial purple style contract`.

### Task 2: Version the executable Style Package

**Files:**
- Modify: `tests/worker/manifest.test.js`
- Modify: `src/worker/manifest.js`

- [ ] Add tests proving new manifests use `schemaVersion: 1` plus `dark-editorial@2`, stored `dark-editorial@1` and `@2` are accepted, and other versions are rejected.
- [ ] Run the focused tests and confirm the expected red failure.
- [ ] Implement the minimal manifest compatibility change.
- [ ] Run the focused tests and confirm green.
- [ ] Commit as `feat: version purple style package`.

### Task 3: Load and validate the licensed fonts

**Files:**
- Create: `tests/fonts.test.js`
- Modify: `src/fonts.js`
- Modify: `src/render.js`
- Modify: `src/worker/production.js`
- Modify: `tests/worker/production.test.js`
- Modify: `tests/render.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add font-loader tests for the exact filenames, aliases, descriptors, sfnt signatures, and approved SHA-256 hashes.
- [ ] Add production tests proving missing or wrong fonts fail as `configuration:invalid_production_font` before any runner is returned.
- [ ] Add a render test proving both private aliases are loaded and checked before output.
- [ ] Run the focused tests with `CAROUSEL_FONT_DIR` set and confirm expected red failures.
- [ ] Implement embedded `@font-face` generation for `CarouselHelveticaDisplay` and `CarouselGriffithsAccent` while retaining Inter for non-display text.
- [ ] Prepare font CSS during production composition and inject it into the renderer closure.
- [ ] Require both exact font descriptors after `document.fonts.ready`; classify browser rejection as `configuration:production_font_unavailable`.
- [ ] Remove the unused Lora dependency.
- [ ] Run the focused tests with the licensed font directory and confirm green.
- [ ] Commit as `feat: load licensed carousel fonts`.

### Task 4: Apply the purple visual system

**Files:**
- Create: `tests/theme.test.js`
- Modify: `styles/dark-editorial.css`
- Modify: `tests/render.test.js`

- [ ] Add tests for `#420D4A` deep surfaces, `#B84FCC` readable text, exact font-role selectors, and absence of electric-blue/Lora declarations.
- [ ] Run the focused tests and confirm the expected red failure.
- [ ] Split the old blue token into deep, text, and soft purple tokens and replace hard-coded blue declarations.
- [ ] Apply Helvetica only to the enumerated display-heading selectors and Griffiths only to `.accent`; keep Inter everywhere else.
- [ ] Run theme and render tests with `CAROUSEL_FONT_DIR` and confirm green.
- [ ] Commit as `feat: make purple theme the default`.

### Task 5: Add the minimally changed scheduled-task prompt

**Files:**
- Create: `prompts/carousel-json-builder.v3.md`
- Modify: `README.md`

- [ ] Copy the v2 prompt exactly into v3.
- [ ] Change only the JSON template accent and prose style requirement from `electric-blue` to `editorial-purple`.
- [ ] Replace only the single-file reuse branch with an `editorial-purple` check that stops old/invalid styles as `needs_human`.
- [ ] Verify with a diff that no other prompt behavior changed.
- [ ] Update README pointers and the style example.
- [ ] Commit as `docs: add purple carousel builder prompt`.

### Task 6: Load private fonts in GitHub Actions

**Files:**
- Modify: `.github/workflows/linkedin-carousel-render.yml`
- Create: `scripts/verify-production-fonts.mjs`
- Create: `tests/verify-production-fonts.test.js`

- [ ] Add tests for reconstruct-time filename and SHA-256 verification.
- [ ] Run the focused test and confirm the expected red failure.
- [ ] Implement a small verifier shared by local checks and CI.
- [ ] Add one non-preflight workflow step that concatenates seven nonempty `CAROUSEL_FONTS_B64_01`…`07` secrets without printing, decodes and extracts them under `$RUNNER_TEMP`, verifies the approved hashes, and exports `CAROUSEL_FONT_DIR`.
- [ ] Add an `if: always()` cleanup step for the temporary archive and directory.
- [ ] Keep workflow trigger, concurrency, credentials, and worker order unchanged.
- [ ] Run focused tests and validate workflow syntax.
- [ ] Commit as `ci: provide licensed carousel fonts`.

### Task 7: Configure, render, and verify

**Files:**
- Generated only: isolated render output outside Git

- [ ] Package only `Helvetica-Bold.ttf` and `Griffiths.otf`, Base64-encode the ZIP, split it into seven chunks of at most 40,000 characters, and set repository secrets `CAROUSEL_FONTS_B64_01`…`07` without printing their values.
- [ ] Run the full local suite with `CAROUSEL_FONT_DIR` set; require zero failures.
- [ ] Run `npm run render` into an isolated directory with `CAROUSEL_FONT_DIR` set.
- [ ] Inspect all eight slide PNGs and confirm font identity, contrast, wrapping, balance, and no clipping.
- [ ] Run `git diff --check`, verify the branch is clean, and push all commits.
- [ ] Trigger GitHub Actions on `codex/default-purple-theme`, confirm tests and a safe idle/preflight path before recommending merge.

