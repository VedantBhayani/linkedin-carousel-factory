import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildDocument } from "../src/document.js";
import { validateCarousel } from "../src/validation.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "input", "carousel.json"), "utf8"));

test("validates the approved eight-slide carousel", () => {
  assert.equal(validateCarousel(structuredClone(fixture)).slides.length, 8);
});

test("rejects a carousel that does not contain exactly eight slides", () => {
  const invalid = structuredClone(fixture);
  invalid.slides.pop();
  assert.throws(() => validateCarousel(invalid), /exactly 8 slides/);
});

test("rejects missing layout-specific fields with a path", () => {
  const invalid = structuredClone(fixture);
  delete invalid.slides[4].rightBody;
  assert.throws(() => validateCarousel(invalid), /carousel\.slides\[4\]\.rightBody/);
});

test("escapes every rendered text value and numbers all pages", () => {
  const input = structuredClone(fixture);
  input.slides[0].headline = '<script>alert("x")</script>';
  input.slides[1].items[0] = "A & B";
  const html = buildDocument(input, "body{}", "");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.equal((html.match(/class="slide/g) || []).length, 8);
  assert.ok(html.includes('01 <span>/</span> 08'));
  assert.ok(html.includes('08 <span>/</span> 08'));
});
