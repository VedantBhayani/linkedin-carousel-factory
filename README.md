# LinkedIn Carousel Renderer

Renders the approved eight-slide LinkedIn carousel to HTML, PDF, a cover JPEG, and eight PNG previews.

```powershell
npm install
npx playwright install chromium
npm test
npm run render
```

Outputs are written to `dist/`. Edit `input/carousel.json` to change the content while preserving the documented V1 schema.
