import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "styles", "dark-editorial.css"), "utf8").replace(/\r\n/g, "\n");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule`);
  return match[1];
}

test("defines the deep and readable purple tokens from the approved swatch", () => {
  assert.match(css, /--accent-deep:\s*#420d4a;/i);
  assert.match(css, /--accent-text:\s*#b84fcc;/i);
  assert.match(css, /rgba\(66, 13, 74,/);
});

test("keeps no electric-blue or Lora declarations", () => {
  for (const retired of [/--blue/, /#5274ff/i, /#8ba0ff/i, /82, 116, 255/, /75, 104, 255/, /Lora/]) {
    assert.doesNotMatch(css, retired);
  }
});

test("readable purple text never uses the deep swatch", () => {
  for (const selector of [".eyebrow", ".accent", ".list-number"]) {
    assert.match(rule(selector), /color: var\(--accent-text\);/, selector);
  }
});

test("assigns the display and accent faces to exactly their roles", () => {
  assert.match(css, /\.title,\n\.hero h1,\n\.statement-content h1,\n\.comparison-card h2,\n\.closing-content h1 \{\n  font-family: var\(--display\);\n  font-weight: 700;\n\}/);
  assert.match(rule(".accent"), /font-family: var\(--editorial\);/);
  assert.doesNotMatch(rule(".list-number"), /font-family/);
  assert.equal(css.match(/var\(--display\)/g).length, 1);
  assert.equal(css.match(/var\(--editorial\)/g).length, 1);
});
