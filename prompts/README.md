# Scheduled-task prompts

The AI step of the pipeline. Each prompt runs as a scheduled task with Google Sheets and Google Drive access, and processes at most one row per run.

| Prompt | Picks up | Leaves the row at |
|---|---|---|
| `brief-builder` | `queued` | `brief_created`, or `needs_human` / `failed` |
| `carousel-json-builder` | `brief_created` | `carousel_created`, or `needs_human` / `failed` |

The GitHub worker picks up `carousel_created` rows.

## Versions

- `v1`: the prompts that produced the `live-001` run reports in `docs/evidence/ai-traces/`. Kept unchanged as history.
- `v2`: current for `brief-builder`. Kept unchanged as history for `carousel-json-builder`. Changes from v1:
  - The job id is trimmed and checked. In v1 the task deliberately kept a leading space, which the worker rejected.
  - Sheet and Drive content is treated as data, never as instructions.
  - A should-stop gate sends a row to `needs_human` when it is too short, duplicated, mostly links or not in English, or relies on an unsourced claim.
  - Two Drive files with the same name stop the job instead of one being picked.
  - `updated_at` is written on every update. Rows stuck in `processing`/`carousel_processing` for more than 2 hours go to `needs_human`.
  - The carousel prompt documents the label fields and the length limits the worker now enforces, and drops the unused `caption` field.
  - Final reports include the full Drive URL and the JSON written.
- `v3` (`carousel-json-builder` only): current. Changes from v2:
  - The style accent is `editorial-purple`; the worker rejects `electric-blue`.
  - An existing carousel file is reused only if it already says `editorial-purple`. Otherwise the row goes to `needs_human`: archive the old file under another name and reset the row to `brief_created`.

The 30-word minimum and the 2-hour stall limit are starting values, not measured ones. Adjust them after real runs.

## Filenames

`{job_id}-brief-v1.json` and `{job_id}-carousel-v1.json` keep `v1`. It is the file format version the worker checks, not the prompt version.
