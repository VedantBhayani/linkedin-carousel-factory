import assert from "node:assert/strict";
import test from "node:test";
import { loadProductionConfig, createProductionRunner } from "../../src/worker/production.js";
import { WorkerError } from "../../src/worker/errors.js";

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
