import { escapeHtml } from "../html.js";

export function closing(slide) {
  return `
    <section class="slide closing" data-layout="closing" data-alignment="center">
      <p class="eyebrow">The takeaway</p>
      <div class="closing-content">
        <h1>${escapeHtml(slide.headline)}</h1>
        <div class="closing-rule" aria-hidden="true"></div>
        <p>${escapeHtml(slide.body)}</p>
      </div>
    </section>`;
}
