import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { WorkerError } from "./worker/errors.js";

const require = createRequire(import.meta.url);

// The licensed display and accent faces. They never live in the repository: local runs and
// GitHub Actions point CAROUSEL_FONT_DIR at a directory holding exactly these two files.
// Unique aliases keep a system-installed Helvetica from standing in for the licensed file.
export const PRODUCTION_FONTS = Object.freeze([
  {
    file: "Helvetica-Bold.ttf",
    family: "CarouselHelveticaDisplay",
    weight: 700,
    style: "normal",
    mime: "font/ttf",
    format: "truetype",
    signatures: ["00010000", "74727565"],
    sha256: "05291f9de00325c3a3f1acdf9a35a8ce4b4fd7d32394482ebb1699ba7ac73ed5"
  },
  {
    file: "Griffiths.otf",
    family: "CarouselGriffithsAccent",
    weight: 400,
    style: "normal",
    mime: "font/otf",
    format: "opentype",
    signatures: ["4f54544f"],
    sha256: "ab3029f2c4ad23fa1b8b12f2e65e6a34adca2dcf435a3bae907768411aa3c77e"
  }
]);

// The exact descriptors the renderer requires Chromium to have loaded before any output.
export const PRODUCTION_FONT_DESCRIPTORS = Object.freeze(
  PRODUCTION_FONTS.map((font) => `${font.weight} 16px "${font.family}"`)
);

function invalidFont(message) {
  return new WorkerError("configuration", "invalid_production_font", message);
}

function inlineCssFile(specifier) {
  const cssPath = require.resolve(specifier);
  const cssDir = path.dirname(cssPath);
  return fs.readFileSync(cssPath, "utf8").replace(
    /url\((['"]?)(\.\/files\/[^)'"\s]+)\1\)/g,
    (_match, _quote, relativePath) => {
      const fontPath = path.resolve(cssDir, relativePath);
      const data = fs.readFileSync(fontPath).toString("base64");
      return `url("data:font/woff2;base64,${data}")`;
    }
  );
}

// Checks the directory holds exactly the approved files and returns their bytes.
// Messages name files only; font bytes and digests of unexpected files are never echoed.
export function readProductionFonts(fontDir) {
  if (!fontDir) throw invalidFont("CAROUSEL_FONT_DIR is not set");
  let entries;
  try {
    entries = fs.readdirSync(fontDir, { withFileTypes: true });
  } catch {
    throw invalidFont("CAROUSEL_FONT_DIR does not exist or cannot be read");
  }
  const expected = PRODUCTION_FONTS.map((font) => font.file);
  const names = entries.map((entry) => entry.name);
  const missing = expected.filter((name) => !names.includes(name));
  if (missing.length) throw invalidFont(`Missing production font: ${missing.join(", ")}`);
  const extra = names.filter((name) => !expected.includes(name));
  if (extra.length) throw invalidFont(`Unexpected file in CAROUSEL_FONT_DIR: ${extra.join(", ")}`);

  return PRODUCTION_FONTS.map((font) => {
    const entry = entries.find((item) => item.name === font.file);
    if (!entry.isFile()) throw invalidFont(`${font.file} is not a regular file`);
    let bytes;
    try {
      bytes = fs.readFileSync(path.join(fontDir, font.file));
    } catch {
      throw invalidFont(`${font.file} cannot be read`);
    }
    if (bytes.length < 4 || !font.signatures.includes(bytes.subarray(0, 4).toString("hex"))) {
      throw invalidFont(`${font.file} is not a valid ${font.format} font file`);
    }
    return { ...font, bytes };
  }).map((font) => {
    // Digests are checked only after every file has the right format, so swapped
    // files are reported as swapped rather than as an unexplained digest mismatch.
    if (createHash("sha256").update(font.bytes).digest("hex") !== font.sha256) {
      throw invalidFont(`${font.file} does not match the approved licensed file`);
    }
    return font;
  });
}

function fontFaceCss(font) {
  return `@font-face {
  font-family: "${font.family}";
  src: url("data:${font.mime};base64,${font.bytes.toString("base64")}") format("${font.format}");
  font-weight: ${font.weight};
  font-style: ${font.style};
  font-display: block;
}`;
}

export function loadEmbeddedFontCss({ fontDir } = {}) {
  const licensed = readProductionFonts(fontDir);
  return [
    inlineCssFile("@fontsource/inter/400.css"),
    inlineCssFile("@fontsource/inter/600.css"),
    ...licensed.map(fontFaceCss)
  ].join("\n");
}
