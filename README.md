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
