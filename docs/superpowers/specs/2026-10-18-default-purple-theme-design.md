# Default Purple Theme Design

## Goal

Make the existing `dark-editorial` carousel's second version the production default: Helvetica Bold for display headings, Griffiths Regular for editorial accent copy, and a purple accent system derived from the supplied `#420D4A` swatch.

## Scope

This changes the one supported production style. It does not add a theme picker, reference ingestion, arbitrary font uploads, or multiple executable styles.

## Typography

- Large display headings use the licensed `Helvetica-Bold.ttf` supplied outside the repository.
- Editorial accent copy (`.accent`, including the hero accent line) uses the licensed `Griffiths.otf` supplied outside the repository.
- Body copy, small labels, eyebrows, page numbers, and functional text remain Inter. Griffiths is intentionally limited to large editorial copy because it is decorative and less suitable for compact labels.
- Rendering fails closed when either production font is unavailable. It must never silently substitute a runner-installed font.
- The renderer continues to wait for `document.fonts.ready` before measuring overflow or producing images and PDF.

## Color system

The supplied swatch's dominant pixel color is `#420D4A`. Its contrast against the current `#07080C` paper is only 1.32:1, so it is not used for readable text.

- `--accent-deep: #420D4A` is used for decorative surfaces, ambient glows, and low-emphasis borders.
- `--accent-text: #B84FCC` is used for purple text and high-emphasis rules. It has approximately 4.79:1 contrast against `#07080C`.
- Existing hard-coded electric-blue RGB values are replaced with named purple tokens so text, borders, and glows are not coupled to one unsuitable shade.

## Style contract and compatibility

- New carousel payloads use `style.family = "dark-editorial"`, `style.accent = "editorial-purple"`, and `style.density = "low"`.
- Newly created render manifests record `style.family = "dark-editorial"` and `style.version = 2`.
- Stored version-1 manifests remain valid for draft reconciliation, so an already rendered job can still finish without being re-rendered.
- Unrendered payloads that still request `electric-blue` are rejected. The scheduled-task prompt and sample payload are updated to emit `editorial-purple`; pending old payloads must be regenerated.

## Licensed font handling

Plaintext commercial font files never enter Git history.

- Local rendering receives a directory through `CAROUSEL_FONT_DIR`; it must contain `Helvetica-Bold.ttf` and `Griffiths.otf`.
- GitHub Actions decrypts an AES-256 encrypted font bundle into a temporary directory and sets `CAROUSEL_FONT_DIR` for tests and the worker.
- Only the encrypted bundle is committed. Its passphrase is stored as the GitHub Actions secret `CAROUSEL_FONTS_PASSPHRASE`.
- The workflow deletes the decrypted directory during cleanup even after failure.
- License documents and purchase receipts stay outside the repository with the original downloads.

## Rendering and PDF behavior

The existing renderer keeps producing eight PNG slides, a cover JPEG, HTML, and a PDF. Font CSS is generated from the two required external files and embeds their bytes as data URLs, preserving deterministic Chromium rendering. The resulting PDF may embed font data; the user has confirmed the purchased licenses cover this automated use.

## Verification

- Unit tests prove the v2 payload contract, v2 manifest creation, and v1 stored-manifest compatibility.
- Font-loader tests prove exact family names, weights, MIME formats, missing-file failures, and no fallback to system fonts.
- Document/CSS tests prove the heading and accent selectors use the intended families and purple tokens.
- Rendering tests run with the licensed files and verify `document.fonts.check()` for both families before output.
- A fresh eight-slide render is visually inspected for overflow, wrapping, font substitution, and low-contrast text.
- The full test suite must pass before the branch is pushed for review.

