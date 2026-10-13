import { escapeHtml } from "../html.js";

export function comparison(slide) {
  return `
    <section class="slide comparison" data-layout="comparison">
      <p class="eyebrow">${escapeHtml(slide.eyebrow ?? "The distinction")}</p>
      <h1 class="title">${escapeHtml(slide.title ?? "Two assets. Two different jobs.")}</h1>
      <div class="comparison-wrapper">
        <article class="comparison-card">
          <span class="comparison-label">${escapeHtml(slide.leftLabel ?? "Explains")}</span>
          <div><h2>${escapeHtml(slide.leftTitle)}</h2><p>${escapeHtml(slide.leftBody)}</p></div>
        </article>
        <article class="comparison-card highlight">
          <span class="comparison-label">${escapeHtml(slide.rightLabel ?? "Creates desire")}</span>
          <div><h2>${escapeHtml(slide.rightTitle)}</h2><p>${escapeHtml(slide.rightBody)}</p></div>
        </article>
      </div>
      ${slide.footer ? `<p class="footer-message">${escapeHtml(slide.footer)}</p>` : ""}
    </section>`;
}
