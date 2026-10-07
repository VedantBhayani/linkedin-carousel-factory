import assert from "node:assert/strict";
import test from "node:test";
import { WorkerError, AmbiguousExternalError, toSafeQueueError } from "../../src/worker/errors.js";

test("WorkerError captures type, code, message, and cause", () => {
  const err = new WorkerError("validation", "invalid_json", "Bad JSON", new Error("cause"));
  assert.equal(err.type, "validation");
  assert.equal(err.code, "invalid_json");
  assert.equal(err.message, "Bad JSON");
  assert.ok(err.cause instanceof Error);
  assert.ok(err instanceof Error);
});

test("AmbiguousExternalError is a WorkerError subtype", () => {
  const err = new AmbiguousExternalError("buffer_ambiguous", "Create may have succeeded");
  assert.ok(err instanceof WorkerError);
  assert.equal(err.type, "ambiguous");
});

test("toSafeQueueError strips URLs", () => {
  const err = new WorkerError("external", "drive_timeout", "Failed to download https://drive.google.com/file/d/abc123/view?usp=sharing");
  const safe = toSafeQueueError(err);
  assert.equal(safe.code, "drive_timeout");
  assert.ok(!safe.message.includes("https://"));
  assert.ok(!safe.message.includes("drive.google.com"));
});

test("toSafeQueueError strips tokens and keys", () => {
  const err = new WorkerError("external", "auth_failed", "Token ya29.a0AfH6SMC... expired");
  const safe = toSafeQueueError(err);
  assert.ok(!safe.message.includes("ya29.a0AfH6SMC"));
});

test("toSafeQueueError strips post text content", () => {
  const err = new WorkerError("external", "render_failed", "Failed rendering: {\"headline\":\"Your launch video shouldn't explain your product\"}");
  const safe = toSafeQueueError(err);
  assert.ok(!safe.message.includes("headline"));
});

test("toSafeQueueError strips JSON payloads", () => {
  const err = new WorkerError("validation", "invalid_json", 'Parse error at {"jobId":"test","slides":[{"layout":"editorial-hook"}]}');
  const safe = toSafeQueueError(err);
  assert.ok(!safe.message.includes("jobId"));
  assert.ok(!safe.message.includes("slides"));
});

test("toSafeQueueError strips stack traces", () => {
  const err = new WorkerError("external", "timeout", "Timeout\n    at renderCarousel (render.js:45)\n    at main (render.js:120)");
  const safe = toSafeQueueError(err);
  assert.ok(!safe.message.includes("at renderCarousel"));
  assert.ok(!safe.message.includes("render.js"));
});

test("toSafeQueueError truncates to 240 chars", () => {
  const longMsg = "x".repeat(300);
  const err = new WorkerError("external", "timeout", longMsg);
  const safe = toSafeQueueError(err);
  assert.ok(safe.message.length <= 240);
});

test("toSafeQueueError includes stage and code", () => {
  const err = new WorkerError("validation", "invalid_json", "Bad JSON");
  const safe = toSafeQueueError(err);
  assert.ok(safe.message.includes("validation"));
  assert.ok(safe.message.includes("invalid_json"));
});

test("toSafeQueueError handles multiline messages", () => {
  const err = new WorkerError("external", "timeout", "Line 1\nLine 2\nLine 3");
  const safe = toSafeQueueError(err);
  assert.ok(!safe.message.includes("\n"));
});

test("toSafeQueueError preserves error type classification", () => {
  const validation = toSafeQueueError(new WorkerError("validation", "invalid_json", "Bad JSON"));
  const external = toSafeQueueError(new WorkerError("external", "timeout", "Timeout"));
  const ambiguous = toSafeQueueError(new AmbiguousExternalError("buffer_ambiguous", "Maybe created"));
  const assetConflict = toSafeQueueError(new WorkerError("asset_conflict", "asset_conflict", "Digest mismatch"));
  const config = toSafeQueueError(new WorkerError("configuration", "missing_secret", "No Cloudinary key"));

  assert.ok(validation.message.startsWith("validation"));
  assert.ok(external.message.startsWith("external"));
  assert.ok(ambiguous.message.startsWith("ambiguous"));
  assert.ok(assetConflict.message.startsWith("asset_conflict"));
  assert.ok(config.message.startsWith("configuration"));
});

test("WorkerError without cause works", () => {
  const err = new WorkerError("validation", "missing_field", "Field required");
  assert.equal(err.cause, undefined);
});