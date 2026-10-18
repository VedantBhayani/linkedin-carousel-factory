# Default Purple Theme Design

## Goal

Make the existing `dark-editorial` carousel's second version the production default: Helvetica Bold for display headings, Griffiths Regular for editorial accent copy, and a purple accent system derived from the supplied `#420D4A` swatch.

## Scope

This changes the one supported production style. It does not add a theme picker, reference ingestion, arbitrary font uploads, or multiple executable styles.

## Typography

- The private CSS alias `CarouselHelveticaDisplay` maps `Helvetica-Bold.ttf` as weight 700, style normal. It is applied to `.title`, `.hero h1`, `.statement-content h1`, `.comparison-card h2`, and `.closing-content h1`.
- The private CSS alias `CarouselGriffithsAccent` maps `Griffiths.otf` as weight 400, style normal. It is applied only to `.accent`, including the hero accent line. The face itself supplies the intended slanted design; CSS does not synthesize italics.
- Body copy, small labels, eyebrows, page numbers, list numbers, and functional text remain Inter. `@fontsource/lora` and every Lora selector are removed.
- Rendering fails closed when either production font is unavailable. It must never silently substitute a runner-installed font.
- After `document.fonts.ready`, the production renderer requires `document.fonts.check('700 16px "CarouselHelveticaDisplay"')` and `document.fonts.check('400 16px "CarouselGriffithsAccent"')` before measuring overflow or producing any output. The unique aliases prevent a system Helvetica from satisfying the check.

## Color system

The supplied swatch's dominant pixel color is `#420D4A`. Its contrast against the current `#07080C` paper is only 1.32:1, so it is not used for readable text.

- `--accent-deep: #420D4A` is used for decorative surfaces, ambient glows, and low-emphasis borders.
- `--accent-text: #B84FCC` is used for purple text and high-emphasis rules. It has approximately 4.79:1 contrast against `#07080C`.
- Existing hard-coded electric-blue RGB values are replaced with named purple tokens so text, borders, and glows are not coupled to one unsuitable shade.

## Style contract and compatibility

- New carousel payloads use `style.family = "dark-editorial"`, `style.accent = "editorial-purple"`, and `style.density = "low"`.
- The carousel payload schema remains version 1 and the Drive filename remains `{JOB_ID}-carousel-v1.json`. This is an intentional breaking migration of the only supported style enum, not a new payload schema.
- Newly created render manifests use `schemaVersion: 1` with `style.family = "dark-editorial"` and `style.version = 2`.
- Stored manifests using `schemaVersion: 1` are accepted only for the tuples `dark-editorial@1` and `dark-editorial@2`. This preserves draft reconciliation for already rendered jobs without accepting unknown styles.
- Unrendered payloads that still request `electric-blue` are rejected. A new `carousel-json-builder.v3.md` producer prompt emits `editorial-purple`; the v2 prompt remains unchanged as historical evidence.

### Rollout for existing Queue Records

The workflow is manual-only, so deployment begins with worker dispatch paused. Before merging, inventory rows that still require rendering (`carousel_created`, `render_retry`, or a recoverable stale `rendering` lock) whose existing Drive payload uses `electric-blue`.

For each affected row: retain the old file for audit under a noncanonical archival name, clear `carousel_file`, `render_manifest`, worker lock/error fields, and render attempts, reset the row to `brief_created`, then run the installed v3 producer prompt to create the one canonical `{JOB_ID}-carousel-v1.json`. Confirm the new file says `editorial-purple` before dispatching the worker. Rows already in the draft stage (`render_created`, `draft_retry`, or a recoverable stale `drafting` lock) with a valid stored Style Package v1 manifest are explicitly excluded and continue through draft reconciliation without reading or regenerating the payload. Finished rows are untouched. Recovering a terminal `render_failed` row is a separate human decision, not part of this rollout. Resume manual worker dispatch only after the render-stage inventory is clean.

## Licensed font handling

Plaintext or encrypted commercial font files never enter Git history. The user has confirmed the purchased licenses cover CI/server rendering, PDF embedding, distributable generated HTML, and this private Actions-secret storage method. If that grant changes, deployment stops until an approved access-controlled source is available.

- Local rendering receives a directory through `CAROUSEL_FONT_DIR`; it must contain `Helvetica-Bold.ttf` and `Griffiths.otf`.
- Before a production runner can claim a Queue Record, startup validates that the directory and exact files exist, are readable, have supported sfnt signatures, and match these approved SHA-256 digests: Helvetica Bold `05291f9de00325c3a3f1acdf9a35a8ce4b4fd7d32394482ebb1699ba7ac73ed5`; Griffiths Regular `ab3029f2c4ad23fa1b8b12f2e65e6a34adca2dcf435a3bae907768411aa3c77e`. Failures are `configuration:invalid_production_font`, never payload validation errors.
- The font loader produces prepared CSS before `createProductionRunner` returns; the renderer receives that CSS through its existing adapter closure. Preflight remains font-independent.
- GitHub Actions stores a ZIP containing only the two approved font files as numbered Base64 chunks in repository Actions secrets (`CAROUSEL_FONTS_B64_01`, and so on), each below GitHub's 48 KB secret limit. The workflow concatenates them without printing, decodes into a uniquely created runner-temporary directory outside the checkout, verifies both hashes, and exports `CAROUSEL_FONT_DIR`.
- An `if: always()` cleanup step removes the reconstructed archive and font directory even after failure. The workflow never prints the secret chunks, archive, font bytes, or temporary paths containing secret material.
- License documents and purchase receipts stay outside the repository with the original downloads.

## Rendering and PDF behavior

The existing renderer keeps producing eight PNG slides, a cover JPEG, HTML, and a PDF. Font CSS is generated from the two required external files and embeds their bytes as data URLs, preserving deterministic Chromium rendering. Font-file, hash, or Chromium font-load failures are configuration failures. Carousel schema and overflow failures remain validation failures.

## Verification

- Unit tests prove the schema-v1 `editorial-purple` payload contract, Style Package v2 manifest creation, and stored Style Package v1 compatibility.
- Font-loader tests prove exact private family aliases, descriptors, MIME formats, approved hashes, missing/corrupt/wrong-file failures, and no fallback to system fonts.
- Document/CSS tests prove the heading and accent selectors use the intended families and purple tokens.
- Rendering tests run with the licensed files and verify `document.fonts.check()` for both families before output.
- A fresh eight-slide render is visually inspected for overflow, wrapping, font substitution, and low-contrast text.
- The full test suite must pass before the branch is pushed for review.

