import { escapeHtml } from "../html.js";

export function statement(slide) {
  return `
    <section class="slide statement" data-layout="statement" data-alignment="center">
      <div class="statement-rule" aria-hidden="true"></div>
      <div class="statement-content">
        <h1>${escapeHtml(slide.headline)}</h1>
        ${slide.body ? `<p>${escapeHtml(slide.body)}</p>` : ""}
      </div>
    </section>`;
}
