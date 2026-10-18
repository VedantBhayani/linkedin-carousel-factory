import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadEmbeddedFontCss, readProductionFonts, PRODUCTION_FONTS } from "../src/fonts.js";
import { WorkerError } from "../src/worker/errors.js";

const licensedDir = process.env.CAROUSEL_FONT_DIR;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "carousel-fonts-"));
}

// Fake files carry the right sfnt signature so only the digest check can reject them.
function writeFakeFonts(dir, overrides = {}) {
  const contents = {
    "Helvetica-Bold.ttf": Buffer.concat([Buffer.from("00010000", "hex"), Buffer.from("fake helvetica")]),
    "Griffiths.otf": Buffer.concat([Buffer.from("OTTO"), Buffer.from("fake griffiths")]),
    ...overrides
  };
  for (const [name, bytes] of Object.entries(contents)) {
    if (bytes !== null) fs.writeFileSync(path.join(dir, name), bytes);
  }
  return dir;
}

function rejectsWith(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "configuration");
    assert.equal(error.code, "invalid_production_font");
    assert.match(error.message, pattern);
    return true;
  });
}

test("requires CAROUSEL_FONT_DIR", () => {
  rejectsWith(() => loadEmbeddedFontCss({}), /CAROUSEL_FONT_DIR is not set/);
});

test("rejects a missing directory", () => {
  rejectsWith(() => readProductionFonts(path.join(tempDir(), "absent")), /does not exist/);
});

test("rejects a directory missing either font", () => {
  rejectsWith(() => readProductionFonts(writeFakeFonts(tempDir(), { "Griffiths.otf": null })), /Missing production font: Griffiths\.otf/);
  rejectsWith(() => readProductionFonts(writeFakeFonts(tempDir(), { "Helvetica-Bold.ttf": null })), /Missing production font: Helvetica-Bold\.ttf/);
});

test("rejects extra files beside the two approved fonts", () => {
  rejectsWith(() => readProductionFonts(writeFakeFonts(tempDir(), { "Helvetica.ttf": Buffer.from("x") })), /Unexpected file.*Helvetica\.ttf/);
});

test("rejects corrupt and swapped files by signature", () => {
  rejectsWith(() => readProductionFonts(writeFakeFonts(tempDir(), { "Helvetica-Bold.ttf": Buffer.from("not a font") })), /Helvetica-Bold\.ttf is not a valid truetype font file/);
  rejectsWith(() => readProductionFonts(writeFakeFonts(tempDir(), { "Griffiths.otf": Buffer.from("00010000", "hex") })), /Griffiths\.otf is not a valid opentype font file/);
});

test("rejects a correctly named font whose digest is not the approved file", () => {
  rejectsWith(() => readProductionFonts(writeFakeFonts(tempDir())), /Helvetica-Bold\.ttf does not match the approved licensed file/);
});

test("error messages never echo font bytes", () => {
  const dir = writeFakeFonts(tempDir());
  assert.throws(() => readProductionFonts(dir), (error) => !error.message.includes("fake helvetica"));
});

test("embeds the licensed fonts under private aliases with exact descriptors", () => {
  const css = loadEmbeddedFontCss({ fontDir: licensedDir });
  for (const font of PRODUCTION_FONTS) {
    const face = css.split("@font-face").find((block) => block.includes(`font-family: "${font.family}"`));
    assert.ok(face, `${font.family} face`);
    assert.match(face, new RegExp(`url\\("data:${font.mime};base64,`));
    assert.match(face, new RegExp(`format\\("${font.format}"\\)`));
    assert.match(face, new RegExp(`font-weight: ${font.weight};`));
    assert.match(face, /font-style: normal;/);
  }
  assert.deepEqual(PRODUCTION_FONTS.map((font) => [font.file, font.family, font.weight]), [
    ["Helvetica-Bold.ttf", "CarouselHelveticaDisplay", 700],
    ["Griffiths.otf", "CarouselGriffithsAccent", 400]
  ]);
  assert.match(css, /font-family: 'Inter'/);
  assert.doesNotMatch(css, /Lora/);
});
