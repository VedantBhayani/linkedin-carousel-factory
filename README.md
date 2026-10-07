# LinkedIn Carousel Factory

Renders the approved eight-slide LinkedIn carousel to HTML, PDF, a cover JPEG, and eight PNG previews, and runs the credential-free production worker core that claims one job, renders it, and advances it toward a Buffer draft with fake adapters.

```powershell
npm install
npx playwright install chromium
npm test
npm run render
```

Outputs are written to `dist/`. Edit `input/carousel.json` to change the content while preserving the documented V1 schema.

## Worker core

```powershell
npm run test:worker
npm run test:worker-integration
```

`src/worker/` holds the provider-independent one-job orchestration: state claims (`job-state.js`), safe errors (`errors.js`), immutable manifests (`manifest.js`), adapter contracts (`ports.js`), one-run orchestration (`run-worker.js`), and the credential-free entry point (`main.js`). Tests use stateful fakes in `tests/helpers/fake-adapters.js`, so no Google, Cloudinary, or Buffer credentials are needed.

Production adapters (Google Sheets/Drive, Cloudinary, Buffer), encrypted secrets, and the five-minute schedule are the next implementation stage and are deliberately not in this increment.

## Production worker

```powershell
npm run worker
```

Runs one composed worker invocation against real Google, Cloudinary, and Buffer services. Configuration comes from the environment, validated before any job is claimed:

| Variable | Source |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account key file contents |
| `SHEET_SPREADSHEET_ID` | Sheet URL between `/d/` and `/edit` |
| `SHEET_NAME` | Worksheet name, defaults to `Sheet1` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | Cloudinary API settings |
| `CLOUDINARY_API_SECRET` | Cloudinary API settings |
| `BUFFER_API_KEY` | `publish.buffer.com/settings/api` |
| `BUFFER_CHANNEL_ID` | GraphQL `channels` query |

Missing variables fail closed with `configuration:missing_production_config` and exit code 1. No secrets are ever logged.

The GitHub workflow runs every 5 minutes under the `carousel-production-worker` concurrency group (one active worker, no overlap). The worker step is skipped until `GOOGLE_SERVICE_ACCOUNT_JSON` is set; partial configuration fails loudly.
