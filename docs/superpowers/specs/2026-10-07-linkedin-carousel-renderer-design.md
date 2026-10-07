# LinkedIn Carousel Renderer Design

## Goal

Build a self-contained V1 renderer under `linkedin-carousel/` that converts the approved eight-slide carousel JSON into a polished 1080 x 1350 HTML document, an eight-page PDF, and a JPEG cover image.

## Scope

The V1 includes five layouts (`editorial-hook`, `framework-overview`, `statement`, `comparison`, and `closing`), one dark editorial stylesheet, JSON input, Playwright rendering, automated structural and overflow checks, and a manually triggered GitHub Actions workflow. Cloudinary and Buffer integration are deliberately excluded until the local renderer is reliable.

The new Node project remains isolated from the existing Python lead-qualification project. Existing source files, dependencies, outputs, and uncommitted changes outside `linkedin-carousel/` will not be modified, except for one repository-root workflow at `.github/workflows/linkedin-carousel-render.yml`, which GitHub requires for workflow discovery.

## Approaches Considered

### Recommended: isolated subproject

Create `linkedin-carousel/` with its own `package.json`, source, tests, input, styles, generated artifacts, and workflow support. This prevents Node dependencies and carousel artifacts from colliding with the existing Python application while keeping everything in the current workspace.

### Repository-root integration

Place `package.json`, `src/`, and `dist/` at the repository root. This is simpler by one directory level but mixes two unrelated applications and makes ownership of commands and generated files unclear.

### Separate Windows project

Build under the previously mentioned `E:\Linkedin Carousell System`. That matches the pasted conversation but is not the workspace the user selected for this run.

## Architecture

`input/carousel.json` is the source of content. Each layout module receives a validated slide object and returns HTML for that layout. A document builder selects the layout, escapes text, adds page numbers, embeds deterministic local fonts, injects the stylesheet, and returns the complete HTML document. The Playwright renderer writes the HTML, prints it to PDF, captures the first slide as `cover.jpg`, and captures every slide as a PNG for visual inspection.

Rendering logic will be separated from browser orchestration so tests can validate HTML generation, escaping, page numbering, unknown-layout errors, and the exact eight-slide structure without launching Chromium. Browser-level verification will check dimensions, page count, and DOM overflow.

## Files

- `linkedin-carousel/input/carousel.json`: approved carousel content.
- `linkedin-carousel/src/layouts/*.js`: focused HTML renderers for the five layouts.
- `linkedin-carousel/src/document.js`: layout dispatch, safe HTML escaping, page numbering, and document assembly.
- `linkedin-carousel/src/render.js`: filesystem and Playwright orchestration.
- `linkedin-carousel/styles/dark-editorial.css`: 1080 x 1350 visual system and print rules.
- `linkedin-carousel/tests/document.test.js`: unit tests for HTML generation and validation.
- `linkedin-carousel/tests/render.test.js`: browser integration checks for artifacts and overflow.
- `linkedin-carousel/package.json`: scripts and pinned runtime/development dependencies.
- `linkedin-carousel/package-lock.json`: reproducible dependency resolution for `npm ci`.
- `.github/workflows/linkedin-carousel-render.yml`: manual CI render and artifact upload, with every command scoped to `linkedin-carousel/`.
- `linkedin-carousel/dist/`: generated HTML, PDF, cover, and page previews; ignored by Git and recreated for every render.

## Input Contract

The top-level value is an object with a non-empty string `title`, an optional `caption` string, a `style` object, and a `slides` array containing exactly eight objects. `style.family`, `style.accent`, and `style.density` are required non-empty strings; the V1 accepts `dark-editorial`, `electric-blue`, and `low` respectively and rejects other values with an actionable path-based message.

Every slide requires a supported string `layout`. Layout fields are:

- `editorial-hook`: required non-empty string `headline`; optional non-empty string `accentText`.
- `framework-overview`: required non-empty string `title`; required `items` array containing one to four non-empty strings; optional non-empty string `footer`.
- `statement`: required non-empty string `headline`; optional non-empty string `body`.
- `comparison`: required non-empty strings `leftTitle`, `leftBody`, `rightTitle`, and `rightBody`; optional non-empty string `footer`.
- `closing`: required non-empty string `headline`; required non-empty string `body`.

Unknown properties are allowed so future metadata does not break V1, but only declared renderable fields reach templates. Validation reports the JSON path, expected type or constraint, and received value/type. Tests cover fewer or more than eight slides, absent fields, wrong types, empty strings, invalid item counts, unsupported layouts/style values, and HTML escaping in every renderable field.

## Data Flow

1. Read and parse `input/carousel.json`.
2. Validate the full input contract, including exactly eight slides and layout-specific fields.
3. Escape all user-provided text before inserting it into HTML.
4. Render each slide and append a zero-padded page number.
5. Remove and recreate only `linkedin-carousel/dist/`, then write `dist/carousel.html`.
6. Load the generated document in Chromium, wait for `document.fonts.ready`, and fail if any slide or content region clips or exceeds its 1080 x 1350 bounds.
7. Export `dist/carousel.pdf`, `dist/cover.jpg`, and `dist/slide-01.png` through `dist/slide-08.png`.
8. Reopen the PDF independently and verify it contains exactly eight pages, each with an 810 x 1012.5 point media box within 0.5 point tolerance.

## Visual Design

The supplied dark editorial direction is retained: near-black background, electric-blue accents, oversized sans-serif headlines, italic serif accents, low content density, thin borders, and subtle radial lighting. Layout spacing is tuned so each slide can be understood quickly and page numbering remains unobtrusive.

Typography uses the packaged `@fontsource/inter` and `@fontsource/lora` WOFF2 assets. The build embeds those font bytes as data URLs in generated CSS, so Windows and Ubuntu render the same faces without runtime network access. All measurement and export operations wait for `document.fonts.ready`.

## Browser and Export Contract

Chromium uses a 1080 x 1350 CSS-pixel viewport with `deviceScaleFactor: 1`. CSS declares `@page { size: 1080px 1350px; margin: 0; }`, gives every slide fixed 1080 x 1350 dimensions, and forces exactly one print page per slide. PDF export uses `printBackground: true`, `preferCSSPageSize: true`, and zero margins.

Screenshots use individual `.slide` locators rather than a viewport clip. The first locator produces JPEG `cover.jpg`; all eight produce PNG files named `slide-01.png` through `slide-08.png`. Image verification independently asserts every preview and the cover is exactly 1080 x 1350 pixels.

## Error Handling

The renderer exits with an actionable error for missing files, invalid JSON, schema violations, unsupported layouts/styles, browser launch failures, content clipping, or missing outputs. The browser is closed in a `finally` block. Each run removes and recreates only `linkedin-carousel/dist/`, so stale artifacts cannot satisfy verification.

Overflow verification runs after fonts are ready. It inspects each `.slide`, named content container, and descendant element bounding box against the slide's inner box with a one-pixel tolerance; it also compares scroll and client dimensions. Any element extending beyond the slide, any container whose content exceeds its box, or any hidden clipping fails the render with the slide number and offending selector/text snippet. `overflow: hidden` is a visual safeguard, not evidence that the slide passed.

## Testing and Verification

Development follows red-green-refactor. Unit tests first establish validation, escaping, layout dispatch, page numbering, and document generation. Integration tests then invoke the renderer and assert that HTML, PDF, cover, and exactly eight correctly named preview images exist; every slide reports zero overflow/clipping; every raster output is 1080 x 1350; and the PDF has exactly eight pages with the required media boxes.

For final visual QA, all PDF pages are rendered to PNG using the bundled PDF tools and inspected for clipped text, overlaps, inconsistent margins, or unreadable glyphs. The final verification command runs `npm test` and `npm run render` from a clean output directory. Package scripts also include `test:unit` and `test:integration` for focused diagnosis.

The root GitHub workflow uses Node 22, sets `defaults.run.working-directory: linkedin-carousel`, runs `npm ci`, installs Chromium and its Ubuntu dependencies with `npx playwright install --with-deps chromium`, runs the tests and renderer, and uploads only `linkedin-carousel/dist/carousel.pdf`, `cover.jpg`, `carousel.html`, and the eight slide PNGs. CI never relies on committed `dist` contents.

## Success Criteria

- `npm run render` completes without warnings or overflow errors.
- `dist/carousel.html`, `dist/carousel.pdf`, and `dist/cover.jpg` are produced.
- The PDF has exactly eight 1080 x 1350-proportioned pages.
- The cover is exactly 1080 x 1350 pixels.
- All eight slide PNGs are exactly 1080 x 1350 pixels and pass automated clipping checks and visual inspection.
- Each PDF media box is 810 x 1012.5 points within 0.5 point tolerance.
- The GitHub workflow can reproduce the render on Ubuntu with Node 22 and Chromium.
- Existing lead-qualification files and user changes remain untouched, except for the explicitly approved root workflow file.
