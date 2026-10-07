import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.CAROUSEL_DIST
  ? path.resolve(process.env.CAROUSEL_DIST)
  : path.join(root, "dist");
const fixturePath = path.join(root, "input", "carousel.json");

function snapshotStats(dir) {
  const files = fs.readdirSync(dir).filter((name) => /^(carousel\.html|carousel\.pdf|cover\.jpg|slide-\d{2}\.png)$/.test(name));
  const stats = {};
  for (const name of files) {
    const p = path.join(dir, name);
    stats[name] = fs.statSync(p).mtimeMs;
  }
  return stats;
}

function listOutputs(dir) {
  return fs.readdirSync(dir).filter((name) => /^(carousel\.html|carousel\.pdf|cover\.jpg|slide-\d{2}\.png)$/.test(name)).sort();
}

const expectedOutputs = [
  "carousel.html",
  "carousel.pdf",
  "cover.jpg",
  "slide-01.png",
  "slide-02.png",
  "slide-03.png",
  "slide-04.png",
  "slide-05.png",
  "slide-06.png",
  "slide-07.png",
  "slide-08.png"
].sort();

test("renders into explicit isolated paths", async () => {
  const { renderCarousel } = await import("../src/render.js");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-render-"));
  const output = path.join(temp, "output");
  fs.mkdirSync(output, { recursive: true });
  const before = snapshotStats(dist);
  await renderCarousel({ inputPath: fixturePath, distDir: output });
  assert.deepEqual(listOutputs(output), expectedOutputs);
  assert.deepEqual(snapshotStats(dist), before);
});

test("renders eight correctly sized slides, cover, HTML, and PDF", async () => {
  execFileSync(process.execPath, [path.join(root, "src", "render.js")], {
    cwd: root,
    stdio: "pipe"
  });

  for (const name of ["carousel.html", "carousel.pdf", "cover.jpg"]) {
    assert.ok(fs.statSync(path.join(dist, name)).size > 0, `${name} should exist and not be empty`);
  }

  const previews = fs.readdirSync(dist).filter((name) => /^slide-\d{2}\.png$/.test(name)).sort();
  assert.deepEqual(previews, Array.from({ length: 8 }, (_, index) => `slide-${String(index + 1).padStart(2, "0")}.png`));

  for (const name of ["cover.jpg", ...previews]) {
    const dimensions = imageSize(fs.readFileSync(path.join(dist, name)));
    assert.equal(dimensions.width, 1080, `${name} width`);
    assert.equal(dimensions.height, 1350, `${name} height`);
  }

  const pdf = await PDFDocument.load(fs.readFileSync(path.join(dist, "carousel.pdf")));
  assert.equal(pdf.getPageCount(), 8);
  for (const [index, page] of pdf.getPages().entries()) {
    const { width, height } = page.getSize();
    assert.ok(Math.abs(width - 810) <= 1, `page ${index + 1} width was ${width}`);
    assert.ok(Math.abs(height - 1012.5) <= 1, `page ${index + 1} height was ${height}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await page.setContent(fs.readFileSync(path.join(dist, "carousel.html"), "utf8"));
    await page.evaluate(() => document.fonts.ready);
    const alignmentIssues = await page.evaluate(() => [...document.querySelectorAll('.hero, .statement, .closing, .framework:not(:has(.footer-message))')]
      .map((slide) => {
        const slideRect = slide.getBoundingClientRect();
        const boxes = [...slide.children]
          .filter((element) => !element.matches('.page-number, [aria-hidden="true"]'))
          .filter((element) => getComputedStyle(element).position !== "absolute")
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        const top = Math.min(...boxes.map((rect) => rect.top));
        const bottom = Math.max(...boxes.map((rect) => rect.bottom));
        const delta = Math.round((top + bottom) / 2 - (slideRect.top + slideRect.height / 2));
        return { slide: Number(slide.querySelector(".page-number")?.textContent.trim().slice(0, 2)), delta };
      })
      .filter(({ delta }) => Math.abs(delta) > 60));
    assert.deepEqual(alignmentIssues, [], `center-aligned slides are visually unbalanced: ${JSON.stringify(alignmentIssues)}`);
  } finally {
    await browser.close();
  }
});
