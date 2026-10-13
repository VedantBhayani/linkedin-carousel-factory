import assert from "node:assert/strict";
import test from "node:test";
import { loadProductionConfig, createProductionRunner, resolveStartupMode, secretValuesFor, summarizeRun } from "../../src/worker/production.js";
import { WorkerError, toSafeQueueError, clearSecretValues } from "../../src/worker/errors.js";

const FULL_ENV = {
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "worker@example.iam.gserviceaccount.com", private_key: "fake-key" }),
  SHEET_SPREADSHEET_ID: "sheet-id-123",
  CLOUDINARY_CLOUD_NAME: "demo",
  CLOUDINARY_API_KEY: "key",
  CLOUDINARY_API_SECRET: "secret",
  BUFFER_API_KEY: "buffer-key",
  BUFFER_CHANNEL_ID: "channel-1"
};

test("loadProductionConfig rejects empty env as configuration errors", () => {
  assert.throws(() => loadProductionConfig({}), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "configuration");
    assert.ok(error.message.includes("GOOGLE_SERVICE_ACCOUNT_JSON"));
    assert.ok(error.message.includes("BUFFER_CHANNEL_ID"));
    return true;
  });
});

test("loadProductionConfig names every missing variable", () => {
  const partial = { ...FULL_ENV };
  delete partial.CLOUDINARY_API_SECRET;
  delete partial.SHEET_SPREADSHEET_ID;
  assert.throws(() => loadProductionConfig(partial), (error) => {
    assert.ok(error.message.includes("CLOUDINARY_API_SECRET"));
    assert.ok(error.message.includes("SHEET_SPREADSHEET_ID"));
    return true;
  });
});

test("loadProductionConfig accepts complete env with Sheet1 default", () => {
  const config = loadProductionConfig({ ...FULL_ENV });
  assert.equal(config.spreadsheetId, "sheet-id-123");
  assert.equal(config.sheetName, "Sheet1");
  assert.equal(config.buffer.channelId, "channel-1");
});

test("loadProductionConfig honors SHEET_NAME overrides", () => {
  const config = loadProductionConfig({ ...FULL_ENV, SHEET_NAME: "Jobs" });
  assert.equal(config.sheetName, "Jobs");
});

test("createProductionRunner composes all five adapters without network calls", () => {
  const run = createProductionRunner(loadProductionConfig({ ...FULL_ENV }));
  assert.equal(typeof run, "function");
});

test("resolveStartupMode skips when no production variables are set", () => {
  assert.deepEqual(resolveStartupMode({}), { mode: "skip" });
});

test("resolveStartupMode runs when any production variable is set", () => {
  assert.deepEqual(resolveStartupMode({ GOOGLE_SERVICE_ACCOUNT_JSON: "x" }), { mode: "run" });
});

test("secretValuesFor lists every credential value, including the service account key", () => {
  const env = {
    ...FULL_ENV,
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "w@example.com", private_key: "-----BEGIN PRIVATE KEY-----abc", private_key_id: "kid-123456" })
  };
  const values = secretValuesFor(loadProductionConfig(env));
  for (const expected of ["key", "secret", "buffer-key", "-----BEGIN PRIVATE KEY-----abc", "kid-123456"]) {
    assert.ok(values.includes(expected), expected);
  }
});

test("createProductionRunner registers credential values for redaction", () => {
  try {
    createProductionRunner(loadProductionConfig({ ...FULL_ENV, BUFFER_API_KEY: "buffer-key-987" }));
    const safe = toSafeQueueError(new WorkerError("external", "http_401", "rejected key buffer-key-987"));
    assert.ok(!safe.message.includes("buffer-key-987"));
  } finally {
    clearSecretValues();
  }
});

test("summarizeRun exits non-zero for a failed job so the workflow run turns red", () => {
  const summary = summarizeRun({ outcome: "failed", error: "content_overflow", jobId: "live-001", stage: "render" });
  assert.equal(summary.exitCode, 1);
  assert.deepEqual(JSON.parse(summary.line), { outcome: "failed", error: "content_overflow", jobId: "live-001", stage: "render" });
});

test("summarizeRun names the job for successful and idle runs", () => {
  const created = summarizeRun({ outcome: "draft_created", draft: { id: "d1" }, manifest: { jobId: "live-001" } });
  assert.equal(created.exitCode, 0);
  assert.deepEqual(JSON.parse(created.line), { outcome: "draft_created", error: null, jobId: "live-001", stage: "draft" });
  const idle = summarizeRun({ outcome: "idle" });
  assert.equal(idle.exitCode, 0);
  assert.deepEqual(JSON.parse(idle.line), { outcome: "idle", error: null, jobId: null, stage: null });
});
