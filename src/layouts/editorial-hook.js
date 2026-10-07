import { escapeHtml } from "../html.js";

export function editorialHook(slide) {
  return `
    <section class="slide hero" data-layout="editorial-hook" data-alignment="center">
      <div class="hero-mark" aria-hidden="true"></div>
      <p class="eyebrow">A better way to launch</p>
      <div class="hero-content">
        <h1>${escapeHtml(slide.headline)}</h1>
        ${slide.accentText ? `<p class="accent accent-line">${escapeHtml(slide.accentText)}</p>` : ""}
      </div>
    </section>`;
}
