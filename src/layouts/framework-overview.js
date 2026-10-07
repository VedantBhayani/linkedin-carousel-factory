import { escapeHtml } from "../html.js";

export function frameworkOverview(slide) {
  const items = slide.items.map((item, index) => `
    <div class="list-item">
      <span class="list-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="list-text">${escapeHtml(item)}</span>
    </div>`).join("");

  return `
    <section class="slide framework ${slide.footer ? "has-footer" : "is-centered"}" data-layout="framework-overview" data-alignment="${slide.footer ? "balanced" : "center"}">
      <p class="eyebrow">The framework</p>
      <h1 class="title">${escapeHtml(slide.title)}</h1>
      <div class="list">${items}</div>
      ${slide.footer ? `<p class="footer-message">${escapeHtml(slide.footer)}</p>` : ""}
    </section>`;
}
