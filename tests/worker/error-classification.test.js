import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWorker } from "../../src/worker/run-worker.js";
import {
  WorkerError,
  toSafeQueueError,
  toWorkerError,
  describeThrown,
  redactForLog,
  registerSecretValues,
  clearSecretValues
} from "../../src/worker/errors.js";
import { failureTransition } from "../../src/worker/job-state.js";
import { renderCarousel } from "../../src/render.js";
import { createFakeQueue, createFakePayloadStore, createFakeRenderer, createFakeAssetStore, createFakeDraftService, createTestClock } from "../helpers/fake-adapters.js";

const style = { family: "dark-editorial", accent: "editorial-purple", density: "low" };

function job(overrides = {}) {
  return {
    jobId: "job-1",
    rowId: "Sheet1!2",
    status: "carousel_created",
    carouselFile: "https://drive.google.com/job-1-carousel-v1.json",
    renderAttempts: 0,
    draftAttempts: 0,
    lockedAt: "",
    workerId: "",
    renderManifest: "",
    bufferDraftId: "",
    bufferDraftUrl: "",
    error: "",
    postText: "post",
    ...overrides
  };
}

function writeOutputs(distDir) {
  mkdirSync(distDir, { recursive: true });
  const write = (name) => { const p = join(distDir, name); writeFileSync(p, `bytes-${name}`); return p; };
  return {
    html: write("carousel.html"),
    pdf: write("carousel.pdf"),
    cover: write("cover.jpg"),
    slides: Array.from({ length: 8 }, (_, i) => write(`slide-0${i + 1}.png`))
  };
}

async function runOnce({ queue, payload, renderer, assets, drafts }) {
  return runWorker({
    ports: {
      JobQueue: queue,
      PayloadStore: payload ?? createFakePayloadStore(),
      CarouselRenderer: renderer ?? createFakeRenderer(async ({ distDir }) => writeOutputs(distDir)),
      AssetStore: assets ?? createFakeAssetStore(),
      DraftService: drafts ?? createFakeDraftService()
    },
    clock: createTestClock(),
    createWorkerId: () => "worker-errors"
  });
}

async function captureConsoleError(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

// A Cloudinary Admin API rejection, shaped like cloudinary/lib/api_client/execute_request.js:
// request_options and query_params come first, the useful error is nested.
function cloudinaryAdminRejection() {
  return {
    request_options: {
      protocol: "https:",
      hostname: "api.cloudinary.com",
      path: `/v1_1/demo/resources/image/upload/carousel%2Fjob-1%2F${"c".repeat(64)}%2Fcarousel-manifest`,
      method: "GET",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "x".repeat(400) }
    },
    query_params: "",
    error: { message: "Resource not found - carousel/job-1/manifest", http_code: 404 }
  };
}

test("schema-invalid carousel JSON fails once as validation instead of three external retries", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({
    jobId: "job-1",
    title: "Test",
    style,
    slides: Array.from({ length: 8 }, () => ({ layout: "statement" }))
  }));
  const queue = createFakeQueue([job()]);
  const payload = createFakePayloadStore(new Map([["job-1-carousel-v1.json", { bytes }]]));

  await runOnce({ queue, payload, renderer: createFakeRenderer(renderCarousel) });

  const row = queue.getJob("Sheet1!2");
  assert.equal(row.status, "render_failed");
  assert.equal(row.renderAttempts, 1);
  assert.match(row.error, /^validation:invalid_carousel /);
  assert.match(row.error, /slides\[0\]\.headline/);
});

test("renderCarousel reports schema problems as typed validation errors", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "carousel-invalid-"));
  const inputPath = join(dir, "bad.json");
  writeFileSync(inputPath, JSON.stringify({ title: "x", style, slides: [] }));

  await assert.rejects(renderCarousel({ inputPath, distDir: join(dir, "out") }), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "validation");
    assert.equal(error.code, "invalid_carousel");
    return true;
  });
});

test("describeThrown reads status and message from a nested Cloudinary rejection", () => {
  const described = describeThrown(cloudinaryAdminRejection());
  assert.equal(described.status, 404);
  assert.equal(described.message, "Resource not found - carousel/job-1/manifest");
});

test("describeThrown reads status from Error objects and flat SDK rejections", () => {
  const gaxiosLike = Object.assign(new Error("File not found: abc"), { status: 404 });
  assert.deepEqual(describeThrown(gaxiosLike), { status: 404, message: "File not found: abc" });
  assert.deepEqual(describeThrown({ message: "Invalid Signature", http_code: 401 }), { status: 401, message: "Invalid Signature" });
  assert.deepEqual(describeThrown("plain string"), { status: null, message: "plain string" });
});

test("toWorkerError keeps the provider status in the code instead of external:unknown", () => {
  const error = toWorkerError(cloudinaryAdminRejection());
  assert.ok(error instanceof WorkerError);
  assert.equal(error.type, "external");
  assert.equal(error.code, "http_404");
  assert.equal(error.message, "Resource not found - carousel/job-1/manifest");
});

test("a thrown plain object reaches the Sheet with its status and message", async () => {
  const queue = createFakeQueue([job()]);
  const payload = createFakePayloadStore(new Map([["job-1-carousel-v1.json", { bytes: new TextEncoder().encode(JSON.stringify({ jobId: "job-1" })) }]]));
  const assets = createFakeAssetStore();
  assets.findManifest = async () => { throw cloudinaryAdminRejection(); };

  let result;
  const log = await captureConsoleError(async () => { result = await runOnce({ queue, payload, assets }); });
  assert.deepEqual({ outcome: result.outcome, jobId: result.jobId, stage: result.stage }, { outcome: "failed", jobId: "job-1", stage: "render" });

  const row = queue.getJob("Sheet1!2");
  assert.equal(row.status, "render_retry");
  assert.match(row.error, /^external:http_404 Resource not found/);
  assert.match(log, /status=404/);
  assert.match(log, /message=Resource not found/);
  assert.match(log, /job=job-1/);
});

test("draft-stage validation errors are terminal", () => {
  const failed = failureTransition(
    { status: "drafting", draftAttempts: 1, renderAttempts: 1 },
    "draft",
    new WorkerError("validation", "invalid_caption", "Draft caption must be a non-empty string")
  );
  assert.equal(failed.status, "draft_failed");
});

test("registered secret values are removed from Sheet errors and logs", () => {
  const cloudinaryKey = "123456789012345";
  const bufferKey = "short-buffer-key";
  registerSecretValues([cloudinaryKey, bufferKey, "", undefined]);
  try {
    const message = `Unknown API key ${cloudinaryKey}; Authorization Bearer ${bufferKey}`;
    const safe = toSafeQueueError(new WorkerError("external", "http_401", message));
    assert.ok(!safe.message.includes(cloudinaryKey));
    assert.ok(!safe.message.includes(bufferKey));
    const logged = redactForLog(message);
    assert.ok(!logged.includes(cloudinaryKey));
    assert.ok(!logged.includes(bufferKey));
    assert.match(logged, /\[secret\]/);
  } finally {
    clearSecretValues();
  }
});

test("log redaction still removes URLs, OAuth tokens, and private keys", () => {
  const logged = redactForLog(
    "GET https://drive.google.com/file/d/abc/view ya29.a0AfH6SMCsecret -----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----"
  );
  assert.ok(!logged.includes("drive.google.com"));
  assert.ok(!logged.includes("a0AfH6SMCsecret"));
  assert.ok(!logged.includes("MIIEv"));
});
