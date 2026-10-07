import { editorialHook } from "./layouts/editorial-hook.js";
import { frameworkOverview } from "./layouts/framework-overview.js";
import { statement } from "./layouts/statement.js";
import { comparison } from "./layouts/comparison.js";
import { closing } from "./layouts/closing.js";
import { validateCarousel } from "./validation.js";

const layouts = {
  "editorial-hook": editorialHook,
  "framework-overview": frameworkOverview,
  statement,
  comparison,
  closing
};

export function renderSlide(slide, index, total) {
  const renderer = layouts[slide.layout];
  if (!renderer) throw new Error(`Unknown layout: ${slide.layout}`);
  const pageNumber = `<div class="page-number">${String(index + 1).padStart(2, "0")} <span>/</span> ${String(total).padStart(2, "0")}</div>`;
  return renderer(slide).replace("</section>", `${pageNumber}</section>`);
}

export function buildDocument(carousel, css, fontCss = "") {
  validateCarousel(carousel);
  const slides = carousel.slides.map((slide, index) => renderSlide(slide, index, carousel.slides.length)).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${carousel.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title>
  <style>${fontCss}\n${css}</style>
</head>
<body>${slides}</body>
</html>`;
}
