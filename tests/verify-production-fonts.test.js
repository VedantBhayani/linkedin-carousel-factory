import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "verify-production-fonts.mjs");
const licensedDir = process.env.CAROUSEL_FONT_DIR;

function verify(dir) {
  return spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
}

function copyLicensed(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-verify-"));
  for (const name of ["Helvetica-Bold.ttf", "Griffiths.otf"]) {
    fs.copyFileSync(path.join(licensedDir, name), path.join(dir, name));
  }
  for (const [name, bytes] of Object.entries(overrides)) {
    if (bytes === null) fs.rmSync(path.join(dir, name));
    else fs.writeFileSync(path.join(dir, name), bytes);
  }
  return dir;
}

function assertFails(result, pattern) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, pattern);
}

test("accepts exactly the two approved fonts", () => {
  const result = verify(copyLicensed());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "Production fonts verified: Helvetica-Bold.ttf, Griffiths.otf");
});

test("fails for a missing directory or file", () => {
  assertFails(verify(path.join(os.tmpdir(), "carousel-verify-absent")), /does not exist/);
  assertFails(verify(copyLicensed({ "Griffiths.otf": null })), /Missing production font: Griffiths\.otf/);
});

test("fails for an extra file", () => {
  assertFails(verify(copyLicensed({ "Helvetica.ttf": Buffer.from("extra") })), /Unexpected file.*Helvetica\.ttf/);
});

test("fails for corrupt and swapped files", () => {
  assertFails(verify(copyLicensed({ "Helvetica-Bold.ttf": Buffer.from("corrupt") })), /Helvetica-Bold\.ttf is not a valid truetype font file/);
  const griffiths = fs.readFileSync(path.join(licensedDir, "Griffiths.otf"));
  const helvetica = fs.readFileSync(path.join(licensedDir, "Helvetica-Bold.ttf"));
  assertFails(verify(copyLicensed({ "Helvetica-Bold.ttf": griffiths, "Griffiths.otf": helvetica })), /Helvetica-Bold\.ttf is not a valid truetype font file/);
});

test("fails for a valid font that is not the approved file, without printing its bytes or path", () => {
  const dir = copyLicensed({ "Helvetica-Bold.ttf": Buffer.concat([Buffer.from("00010000", "hex"), Buffer.from("other font")]) });
  const result = verify(dir);
  assertFails(result, /Helvetica-Bold\.ttf does not match the approved licensed file/);
  assert.ok(!result.stderr.includes("other font"));
  assert.ok(!result.stderr.includes(dir));
});
