import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildDocument } from "./document.js";
import { loadEmbeddedFontCss } from "./fonts.js";

async function findClipping(page) {
  return page.evaluate(() => {
    const tolerance = 1;
    const issues = [];
    document.querySelectorAll(".slide").forEach((slide, slideIndex) => {
      const slideRect = slide.getBoundingClientRect();
      const elements = [slide, ...slide.querySelectorAll("*")];
      elements.forEach((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const decorative = Boolean(element.closest('[aria-hidden="true"]'));
        const outside = rect.left < slideRect.left - tolerance || rect.top < slideRect.top - tolerance ||
          rect.right > slideRect.right + tolerance || rect.bottom > slideRect.bottom + tolerance;
        const clipsOwnContent = element !== slide && !decorative &&
          [style.overflowX, style.overflowY].some((value) => ["hidden", "clip", "auto", "scroll"].includes(value));
        const scrollClips = clipsOwnContent &&
          (element.scrollWidth > element.clientWidth + tolerance || element.scrollHeight > element.clientHeight + tolerance);
        if (!decorative && ((outside && rect.width > 0 && rect.height > 0) || scrollClips)) {
          issues.push({
            slide: slideIndex + 1,
            tag: element.tagName.toLowerCase(),
            className: element.className || "",
            text: (element.textContent || "").trim().slice(0, 80),
            outside,
            scrollClips,
            overflow: style.overflow
          });
        }
      });
    });
    return issues;
  });
}

export async function renderCarousel({ inputPath, distDir }) {
  function readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`Could not read ${filePath}: ${error.message}`);
    }
  }

  const carousel = readJson(inputPath);
  const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "styles", "dark-editorial.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const html = buildDocument(carousel, css, loadEmbeddedFontCss());

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "carousel.html"), html, "utf8");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1350 },
      deviceScaleFactor: 1
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    const slides = page.locator(".slide");
    const slideCount = await slides.count();
    if (slideCount !== 8) throw new Error(`Expected 8 rendered slides, found ${slideCount}`);

    const clipping = await findClipping(page);
    if (clipping.length) {
      throw new Error(`Detected clipped or overflowing content:\n${JSON.stringify(clipping, null, 2)}`);
    }

    for (let index = 0; index < slideCount; index += 1) {
      await slides.nth(index).screenshot({
        path: path.join(distDir, `slide-${String(index + 1).padStart(2, "0")}.png`),
        type: "png"
      });
    }
    await slides.first().screenshot({
      path: path.join(distDir, "cover.jpg"),
      type: "jpeg",
      quality: 92
    });

    await page.pdf({
      path: path.join(distDir, "carousel.pdf"),
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
  } finally {
    await browser.close();
  }

  return {
    html: path.join(distDir, "carousel.html"),
    pdf: path.join(distDir, "carousel.pdf"),
    cover: path.join(distDir, "cover.jpg"),
    slides: Array.from({ length: 8 }, (_, index) =>
      path.join(distDir, `slide-${String(index + 1).padStart(2, "0")}.png`))
  };
}

function getDefaultInputPath() {
  return process.env.CAROUSEL_INPUT
    ? path.resolve(process.env.CAROUSEL_INPUT)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "input", "carousel.json");
}

function getDefaultDistDir() {
  return process.env.CAROUSEL_DIST
    ? path.resolve(process.env.CAROUSEL_DIST)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
}

async function main() {
  const inputPath = getDefaultInputPath();
  const distDir = getDefaultDistDir();
  await renderCarousel({ inputPath, distDir });

  console.log("Carousel generated:");
  console.log("  dist/carousel.html");
  console.log("  dist/carousel.pdf");
  console.log("  dist/cover.jpg");
  console.log("  dist/slide-01.png ... dist/slide-08.png");
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

import { pathToFileURL } from "node:url";