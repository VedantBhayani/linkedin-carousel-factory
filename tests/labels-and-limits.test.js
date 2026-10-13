import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildDocument, renderSlide } from "../src/document.js";
import { validateCarousel } from "../src/validation.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = () => JSON.parse(fs.readFileSync(path.join(root, "input", "carousel.json"), "utf8"));

const DEFAULTS = [
  [{ layout: "editorial-hook", headline: "H" }, ["A better way to launch"]],
  [{ layout: "framework-overview", title: "T", items: ["a"] }, ["The framework"]],
  [{ layout: "closing", headline: "H", body: "B" }, ["The takeaway"]],
  [
    { layout: "comparison", leftTitle: "L", leftBody: "LB", rightTitle: "R", rightBody: "RB" },
    ["The distinction", "Two assets. Two different jobs.", "Explains", "Creates desire"]
  ]
];

test("slides without label fields keep today's default labels", () => {
  for (const [slide, labels] of DEFAULTS) {
    const html = renderSlide(slide, 0, 8);
    for (const label of labels) assert.ok(html.includes(label), `${slide.layout}: ${label}`);
  }
});

test("custom labels replace the defaults", () => {
  assert.ok(renderSlide({ layout: "editorial-hook", headline: "H", eyebrow: "Pricing, honestly" }, 0, 8).includes(">Pricing, honestly<"));
  assert.ok(!renderSlide({ layout: "editorial-hook", headline: "H", eyebrow: "Pricing, honestly" }, 0, 8).includes("A better way to launch"));
  assert.ok(renderSlide({ layout: "framework-overview", title: "T", items: ["a"], eyebrow: "Three steps" }, 0, 8).includes(">Three steps<"));
  assert.ok(renderSlide({ layout: "closing", headline: "H", body: "B", eyebrow: "So what" }, 0, 8).includes(">So what<"));
  const comparison = renderSlide({
    layout: "comparison",
    eyebrow: "Side by side",
    title: "Cold email vs warm intro",
    leftLabel: "Scales",
    leftTitle: "L",
    leftBody: "LB",
    rightLabel: "Converts",
    rightTitle: "R",
    rightBody: "RB"
  }, 0, 8);
  for (const text of [">Side by side<", ">Cold email vs warm intro<", ">Scales<", ">Converts<"]) assert.ok(comparison.includes(text), text);
  for (const text of ["The distinction", "Two assets", "Explains", "Creates desire"]) assert.ok(!comparison.includes(text), text);
});

test("labels are HTML-escaped", () => {
  const html = renderSlide({ layout: "editorial-hook", headline: "H", eyebrow: "<b>x</b> & \"y\"" }, 0, 8);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;"));
  assert.ok(!html.includes("<b>x</b>"));
});

test("over-long labels are rejected with a path", () => {
  const carousel = fixture();
  carousel.slides[0].eyebrow = "x".repeat(41);
  assert.throws(() => validateCarousel(carousel), /slides\[0\]\.eyebrow must be at most 40 characters/);

  const words = fixture();
  words.slides[0].eyebrow = "one two three four five six seven";
  assert.throws(() => validateCarousel(words), /slides\[0\]\.eyebrow must be at most 6 words/);

  const comparison = fixture();
  comparison.slides[4].leftLabel = "x".repeat(25);
  assert.throws(() => validateCarousel(comparison), /slides\[4\]\.leftLabel must be at most 24 characters/);
});

test("empty labels are rejected instead of rendering an empty eyebrow", () => {
  const carousel = fixture();
  carousel.slides[7].eyebrow = "  ";
  assert.throws(() => validateCarousel(carousel), /slides\[7\]\.eyebrow must be a non-empty string/);
});

test("headline-type fields are capped at 11 words, as the prompt requires", () => {
  const carousel = fixture();
  carousel.slides[2].headline = "one two three four five six seven eight nine ten eleven twelve";
  assert.throws(() => validateCarousel(carousel), /slides\[2\]\.headline must be at most 11 words/);
  carousel.slides[2].headline = "one two three four five six seven eight nine ten eleven";
  assert.doesNotThrow(() => validateCarousel(carousel));
});

test("body-type fields and list items are capped at 24 words", () => {
  const long = Array.from({ length: 25 }, (_, i) => `w${i}`).join(" ");
  const body = fixture();
  body.slides[2].body = long;
  assert.throws(() => validateCarousel(body), /slides\[2\]\.body must be at most 24 words/);
  const item = fixture();
  item.slides[1].items[0] = long;
  assert.throws(() => validateCarousel(item), /slides\[1\]\.items\[0\] must be at most 24 words/);
});

test("unknown fields are rejected so typos cannot silently drop copy", () => {
  const slide = fixture();
  slide.slides[0].acentText = "typo";
  assert.throws(() => validateCarousel(slide), /slides\[0\] has unsupported field "acentText"/);
  const top = fixture();
  top.subtitle = "x";
  assert.throws(() => validateCarousel(top), /carousel has unsupported field "subtitle"/);
});

test("the Drive fixture's referenceCollection field is still accepted", () => {
  const drive = JSON.parse(fs.readFileSync(path.join(root, "input", "launch-video-001-carousel-v1.drive.json"), "utf8"));
  assert.doesNotThrow(() => validateCarousel(drive));
});

test("buildDocument output for the sample carousel is unchanged by the label fields", () => {
  const css = fs.readFileSync(path.join(root, "styles", "dark-editorial.css"), "utf8");
  const html = buildDocument(fixture(), css, "");
  assert.ok(html.includes('<p class="eyebrow">A better way to launch</p>'));
  assert.ok(html.includes('<h1 class="title">Two assets. Two different jobs.</h1>'));
});
