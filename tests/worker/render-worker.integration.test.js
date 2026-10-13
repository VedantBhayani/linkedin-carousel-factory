import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { runWorker } from "../../src/worker/run-worker.js";
import { renderCarousel } from "../../src/render.js";
import { sha256Bytes } from "../../src/worker/manifest.js";
import {
  createFakeQueue,
  createFakePayloadStore,
  createFakeRenderer,
  createFakeAssetStore,
  createFakeDraftService,
  createTestClock
} from "../helpers/fake-adapters.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const driveFixturePath = path.join(root, "input", "launch-video-001-carousel-v1.drive.json");
const sharedInputPath = path.join(root, "input", "carousel.json");
const distDir = path.join(root, "dist");
const tmpDir = path.join(root, "tmp");

test("real renderer produces verified draft_created end to end", async () => {
  const fixtureBytes = fs.readFileSync(driveFixturePath);
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  assert.equal(fixture.jobId, "launch-video-001");

  const job = {
    jobId: "launch-video-001",
    rowId: "Sheet1!2",
    status: "carousel_created",
    carouselFile: "https://drive.google.com/launch-video-001-carousel-v1.json",
    renderAttempts: 0,
    draftAttempts: 0,
    lockedAt: "",
    workerId: "",
    renderManifest: "",
    bufferDraftId: "",
    bufferDraftUrl: "",
    error: "",
    updatedAt: new Date().toISOString(),
    postText: "integration test caption, word for word"
  };

  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["launch-video-001-carousel-v1.json", { bytes: fixtureBytes }]]));
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();

  let renderedPdfPages = 0;
  let renderOutDir = null;
  const renderer = createFakeRenderer(async ({ inputPath, distDir: outDir }) => {
    renderOutDir = outDir;
    const result = await renderCarousel({ inputPath, distDir: outDir });
    const pdf = await PDFDocument.load(fs.readFileSync(result.pdf));
    renderedPdfPages = pdf.getPageCount();
    return result;
  });

  const sharedInputBefore = fs.statSync(sharedInputPath).mtimeMs;

  const result = await runWorker({
    ports: {
      JobQueue: queue,
      PayloadStore: payload,
      CarouselRenderer: renderer,
      AssetStore: assets,
      DraftService: drafts
    },
    clock: createTestClock(),
    createWorkerId: () => "worker-integration"
  });

  assert.equal(result.outcome, "draft_created");
  assert.equal(renderedPdfPages, 8);

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "draft_created");
  assert.ok(updated.renderManifest.startsWith("cloudinary://launch-video-001:"));
  assert.ok(updated.bufferDraftId.length > 0);

  assert.ok(result.manifest);
  assert.equal(result.manifest.jobId, "launch-video-001");
  assert.equal(result.manifest.payloadSha256, sha256Bytes(fixtureBytes));
  assert.equal(result.manifest.files.slides.length, 8);
  assert.ok(result.manifest.files.pdf.url.startsWith("https://"));
  assert.ok(result.manifest.files.cover.url.startsWith("https://"));
  for (const slide of result.manifest.files.slides) {
    assert.ok(slide.url.startsWith("https://"));
    assert.ok(slide.bytes > 0);
  }

  assert.equal(drafts.calls.createDraft, 1);
  assert.equal(drafts.lastCreate.caption, "integration test caption, word for word");
  assert.equal(drafts.lastCreate.runKey, result.manifest.runKey);

  const leftovers = fs.existsSync(tmpDir)
    ? fs.readdirSync(tmpDir).filter((name) => name === "worker-worker-integration")
    : [];
  assert.deepEqual(leftovers, []);
  // The worker must render into its own temporary directory, never the shared dist/.
  // This is checked on the path the worker hands to the renderer, not by watching dist/:
  // node --test runs test files in parallel and tests/render.test.js writes dist/ itself,
  // which made a dist/ snapshot fail on a fresh CI runner (run 38402544297).
  assert.equal(path.relative(path.join(tmpDir, "worker-worker-integration"), renderOutDir), "output");
  assert.notEqual(path.resolve(renderOutDir), path.resolve(distDir));
  assert.equal(fs.statSync(sharedInputPath).mtimeMs, sharedInputBefore);
});
