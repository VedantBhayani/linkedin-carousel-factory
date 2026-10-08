# Cloudinary Raw Public IDs Design

## Problem

The production worker successfully uploads rendered assets, but a later draft-only invocation cannot reload the stored render manifest. The live manifest is publicly deliverable and validates correctly, while Cloudinary's Admin API lookup returns no resource for the extensionless raw public ID.

The adapter currently strips extensions from every asset public ID. That is correct for image assets, but Cloudinary requires raw asset public IDs to include their original extension. Consequently, the PDF is stored as `carousel` and the manifest as `carousel-manifest` instead of `carousel.pdf` and `carousel-manifest.json`.

## Decision

Preserve filename extensions for raw assets and continue stripping extensions for image assets.

- PDF public ID: `carousel/<jobId>/<hash>/carousel.pdf`
- Manifest public ID: `carousel/<jobId>/<hash>/carousel-manifest.json`
- Cover and slide public IDs remain extensionless internally and continue using Cloudinary image delivery formats.
- The durable Sheet locator remains `cloudinary://<jobId>:<sha256>`; no Sheet schema change is required.

## Data Flow

On render, the asset store determines each asset's Cloudinary resource type. Raw assets retain their filename extension in the public ID, while image assets use the existing basename behavior. The manifest is uploaded and subsequently queried using the same `.json` public ID. A draft-only run resolves the unchanged locator, retrieves the manifest through Cloudinary's Admin API, validates it, and passes its PDF and cover URLs to Buffer.

## Existing Assets and Recovery

Legacy extensionless raw assets remain untouched. The `live-001` row will be reset to a render retry after deployment so the corrected adapter writes extension-bearing raw assets and a retrievable manifest. Existing image assets may be reused; the corrected raw IDs do not conflict with their legacy extensionless counterparts.

No generic migration or legacy fallback is added because the current queue has one known affected live job and rerendering it is deterministic.

## Error Handling

Existing error classification remains unchanged. Cloudinary transport and Admin API failures remain external errors. Missing or structurally invalid stored manifests remain data-integrity errors. Buffer failures remain draft-stage errors and do not trigger a rerender when the stored manifest is valid.

## Tests

Add regression coverage that models Cloudinary's raw public-ID contract:

1. Stored PDF and manifest raw public IDs include `.pdf` and `.json`.
2. Image public IDs retain the existing extensionless behavior.
3. A manifest stored by the adapter can be loaded by its durable locator using the exact extension-bearing public ID.
4. The complete existing test suite remains green.

The regression test must fail against the current implementation before production code changes are made.

## Rollout and Verification

After tests pass, commit and push the adapter fix to `master`. Then repair `live-001` by setting it to `render_retry`, restoring its render-attempt counter to the final permitted attempt, clearing the stale error, and manually dispatching the workflow once. Completion requires:

- the workflow production-worker output reports `draft_created`;
- the Sheet contains a valid Cloudinary locator, Buffer draft ID, and Buffer draft URL;
- Cloudinary contains the PDF, cover, eight slide images, and manifest under the corrected run-key path.