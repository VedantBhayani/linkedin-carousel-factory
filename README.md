# LinkedIn Carousel Factory

Turns a LinkedIn post written in a Google Sheet into an unpublished Buffer draft: an eight-slide 1080×1350 PDF carousel with a cover image.

## Pipeline

```
Google Sheet row (status: queued)
  │  scheduled task: prompts/brief-builder.v2.md
  ▼
brief JSON in Drive               (status: brief_created)
  │  scheduled task: prompts/carousel-json-builder.v3.md
  ▼
carousel JSON in Drive            (status: carousel_created)
  │  GitHub Actions "Render LinkedIn Carousel", dispatched manually
  ▼
Playwright/Chromium render → Cloudinary (immutable, content-hash IDs)   (status: render_created)
  ▼
Buffer draft via GraphQL (saveToDraft)                                   (status: draft_created)
```

- **AI step:** two scheduled-task prompts with Sheet and Drive access. They write the editorial brief and the slide copy, and stop rows that need a person.
- **Deterministic step:** the GitHub worker. It validates the JSON, renders, stores the assets and creates the draft. It does no editorial reasoning.
- **Trigger:** the workflow runs only when someone dispatches it (`workflow_dispatch`). There is no schedule.

## What stays human

- **Adding posts:** adding a row and setting it to `queued` is the approval to start.
- **`needs_human` rows:** the scheduled tasks set this for:
  - posts under 30 words, duplicated, mostly links or not in English
  - posts whose key claim is unsourced
  - unsafe job ids
  - duplicate Drive files
  - stalled rows
- **Worker stops:** the worker stops on duplicate `post_text` (`duplicate_post_text`), on several Buffer drafts with the same caption (`multiple_matching_drafts`), and on content that fails validation or overflows a slide.
- **Publishing:** the system only creates drafts. A person reviews and publishes them in Buffer.

## Sheet

Row 1 must contain these headers, in any order. Extra columns are allowed. Cells are written by header name.

`job_id`, `post_text`, `status`, `carousel_file`, `render_attempts`, `draft_attempts`, `worker_id`, `locked_at`, `render_manifest`, `buffer_draft_id`, `buffer_draft_url`, `error`, `updated_at`. The scheduled tasks also use `brief_file`.

If one of the worker's headers is missing, the worker stops with `configuration:missing_sheet_header` before claiming anything.

| Status | Set by | Meaning |
|---|---|---|
| `queued` | person | ready for the brief task |
| `processing`, `brief_created` | brief task | brief in progress / done |
| `carousel_processing`, `carousel_created` | carousel task | slides in progress / ready for the worker |
| `needs_human`, `failed` | either task | stopped; reason in `error` |
| `rendering`, `render_retry`, `render_created`, `render_failed` | worker | render stage |
| `drafting`, `draft_retry`, `draft_created`, `draft_failed` | worker | Buffer stage |

Each worker stage gets 3 attempts. Validation and configuration errors are terminal on the first attempt. A lock older than 30 minutes is reclaimed. A stale lock on the final attempt becomes `*_failed` with `stale_lock_exhausted`.

`buffer_draft_url` is filled from Buffer's `externalLink`. That field is nullable and is expected to stay empty for unpublished drafts, though this has not been confirmed (see `docs/adr/0001-buffer-draft-reconciliation.md`).

## Running it from GitHub Actions

Repository secrets:

| Secret | Source |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | service account key file contents; share the Sheet (editor) and the Drive folder (viewer) with its email |
| `SHEET_SPREADSHEET_ID` | Sheet URL between `/d/` and `/edit` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary API settings |
| `BUFFER_API_KEY` | `publish.buffer.com/settings/api` |
| `BUFFER_CHANNEL_ID` | GraphQL `channels` query |
| `CAROUSEL_FONTS_B64_01` … `CAROUSEL_FONTS_B64_07` | the licensed fonts (see below) |

### Licensed fonts

Headings use Helvetica Bold and accent lines use Griffiths Regular. Both are licensed and never committed. A render needs `CAROUSEL_FONT_DIR` pointing at a directory that holds exactly `Helvetica-Bold.ttf` and `Griffiths.otf`. Their SHA-256 digests must match the ones in `src/fonts.js`. Anything else stops the run as `configuration:invalid_production_font` before a row is claimed. If Chromium cannot load a face, the run stops as `configuration:production_font_unavailable` before any file is written. The renderer never falls back to another font.

In Actions, the two files are zipped, Base64-encoded and split into seven secrets of at most 40,000 characters. The **Load licensed fonts** step rebuilds them under `$RUNNER_TEMP` and checks them with `scripts/verify-production-fonts.mjs`. The last step deletes them, even when an earlier step fails. Preflight does not need the fonts.

Actions → **Render LinkedIn Carousel** → Run workflow:

- `mode: preflight`: read-only. It checks headers, duplicate posts, job ids and statuses, names the row the worker would take next, and checks that the service account can see that row's Drive file. It writes nothing and does not print post text.
- `mode: run`: runs the tests, then processes at most one job. The log ends with one line such as `{"outcome":"draft_created","error":null,"jobId":"live-001","stage":"draft"}`. A failed job exits 1, so the run shows red.

All runs share one concurrency group, so only one worker runs at a time.

Buffer must be able to fetch the PDF from Cloudinary. Buffer once rejected a draft with "Document could not be read from its URL". Cloudinary blocks PDF delivery by default on free plans ("Allow delivery of PDF and ZIP files" under Settings → Security). Check that setting first if this error comes back.

## Local development

```bash
npm ci
npx playwright install chromium
export CAROUSEL_FONT_DIR=/path/to/licensed/fonts
npm test
npm run render
```

`npm test` and `npm run render` need `CAROUSEL_FONT_DIR`. `npm run render` renders `input/carousel.json` to `dist/` (ignored by git). `examples/launch-video-001/` holds one committed sample render.

`npm run worker` and `npm run preflight` need the same environment variables as the workflow. With none of them set, `npm run worker` exits without doing anything.

## Carousel JSON

```json
{ "jobId": "live-001", "title": "…", "style": { "family": "dark-editorial", "accent": "editorial-purple", "density": "low" }, "slides": [ … 8 slides … ] }
```

| Layout | Required | Optional |
|---|---|---|
| `editorial-hook` | `headline` | `accentText`, `eyebrow` |
| `framework-overview` | `title`, `items` (1–4) | `footer`, `eyebrow` |
| `statement` | `headline` | `body` |
| `comparison` | `leftTitle`, `leftBody`, `rightTitle`, `rightBody` | `footer`, `eyebrow`, `title`, `leftLabel`, `rightLabel` |
| `closing` | `headline`, `body` | `eyebrow` |

Limits:
- Headline-type fields: at most 11 words.
- Body-type fields and list items: at most 24 words.
- `eyebrow`: at most 6 words / 40 characters.
- Card labels: at most 3 words / 24 characters.

Unknown fields are rejected. Labels that are left out fall back to the original launch-video wording, so the JSON-builder prompt always sets them. The renderer also rejects text that is clipped by or overflows a slide.

## Layout of the code

- `src/render.js`, `src/document.js`, `src/layouts/`, `src/validation.js`, `styles/`: the renderer.
- `src/worker/`:
  - `job-state.js`: state machine
  - `run-worker.js`: one-run orchestration
  - `manifest.js`: immutable render manifests
  - `errors.js`: typed errors and redaction
  - `production.js`: entry point
  - `preflight.js`: read-only check
- `src/adapters/`: Google Sheets, Drive, Cloudinary, Buffer.
- `tests/`: `node --test`. Stateful fakes live in `tests/helpers/fake-adapters.js` and follow the production adapters' contracts.
- `docs/adr/`: decisions. `docs/evidence/`: test runs, AI traces, incident notes. `docs/wayfinder/`: the original design map; not everything there is built (see its "Built vs designed" section).

## Known limits

- No schedule; someone dispatches the workflow.
- Buffer has no idempotency key. An unrecorded draft is recognised only by its exact caption (see the ADR).
- When an upload hits an existing Cloudinary asset, only the byte size is compared, because Cloudinary reports size, not a documented digest.
- One style only (`dark-editorial`). No reference images are analysed.
- The only failure notification is GitHub's failed-run email.
