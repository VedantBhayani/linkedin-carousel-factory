import assert from "node:assert/strict";
import test from "node:test";
import { runWorker } from "../../src/worker/run-worker.js";
import { createFakeQueue, createFakePayloadStore, createFakeRenderer, createFakeAssetStore, createFakeDraftService, createTestClock, createWorkerId } from "../helpers/fake-adapters.js";
import { renderCarousel } from "../../src/render.js";

const fixturePath = "E:/linkedin-carousel-factory/input/carousel.json";
const driveBytes = new TextEncoder().encode(JSON.stringify({ jobId: "job-1", title: "Test", style: { family: "dark-editorial", accent: "electric-blue", density: "low" }, slides: Array.from({ length: 8 }, (_, i) => ({ layout: "editorial-hook", headline: `Slide ${i + 1}`, accentText: "Test" })) }));
const driveBytesTest001 = new TextEncoder().encode(JSON.stringify({ jobId: "test-001", title: "Test", style: { family: "dark-editorial", accent: "electric-blue", density: "low" }, slides: Array.from({ length: 8 }, (_, i) => ({ layout: "editorial-hook", headline: `Slide ${i + 1}`, accentText: "Test" })) }));

function makePorts({ queue, payload, renderer, assets, drafts }) {
  return {
    JobQueue: queue,
    PayloadStore: payload,
    CarouselRenderer: renderer,
    AssetStore: assets,
    DraftService: drafts
  };
}

test("idle: no eligible job returns idle with no side effects", async () => {
  const queue = createFakeQueue([]);
  const payload = createFakePayloadStore();
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  const result = await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "idle");
  assert.equal(queue.calls.findEligible, 1);
  assert.equal(queue.calls.persistClaim, 0);
  assert.equal(payload.calls.download, 0);
  assert.equal(renderer.calls.render, 0);
  assert.equal(assets.calls.store, 0);
  assert.equal(drafts.calls.findDraft, 0);
});

test("claims exactly one eligible job", async () => {
  const job1 = { jobId: "job-1", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/job-1-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "post 1" };
  const job2 = { jobId: "job-2", rowId: "Sheet1!3", status: "carousel_created", carouselFile: "https://drive.google.com/job-2-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "post 2" };
  
  const queue = createFakeQueue([job1, job2]);
  const payload = createFakePayloadStore(new Map([
    ["job-1-carousel-v1.json", { bytes: driveBytes }],
    ["job-2-carousel-v1.json", { bytes: driveBytes }]
  ]));
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.equal(queue.calls.persistClaim, 1);
  const claimedJob = queue.getJob("Sheet1!2");
  assert.equal(claimedJob.status, "render_created");
  assert.equal(claimedJob.renderAttempts, 1);
  assert.equal(claimedJob.workerId, "");
});

test("persistClaim occurs before download", async () => {
  const job = { jobId: "job-1", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/job-1-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "post" };
  
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["job-1-carousel-v1.json", { bytes: driveBytes }]]));
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();
  
  let claimBeforeDownload = false;
  const originalDownload = payload.download.bind(payload);
  payload.download = async (...args) => {
    if (queue.calls.persistClaim > 0) claimBeforeDownload = true;
    return originalDownload(...args);
  };

  await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.ok(claimBeforeDownload, "persistClaim should happen before download");
});

test("wrong filename fails without rendering", async () => {
  const job = { jobId: "job-1", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/wrong-name.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "post" };
  
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["wrong-name.json", { bytes: driveBytes }]]));
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "render_failed");
  assert.ok(updated.error.includes("filename"));
  assert.equal(renderer.calls.render, 0);
});

test("mismatched jobId in JSON fails without rendering", async () => {
  const mismatchedBytes = new TextEncoder().encode(JSON.stringify({ jobId: "different-job", title: "Test", style: { family: "dark-editorial", accent: "electric-blue", density: "low" }, slides: Array.from({ length: 8 }, (_, i) => ({ layout: "editorial-hook", headline: `Slide ${i + 1}` })) }));
  
  const job = { jobId: "job-1", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/job-1-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "post" };
  
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["job-1-carousel-v1.json", { bytes: mismatchedBytes }]]));
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "render_failed");
  assert.ok(updated.error.includes("jobId"));
  assert.equal(renderer.calls.render, 0);
});

test("validation error becomes terminal render_failed", async () => {
  const invalidBytes = new TextEncoder().encode("not valid json");
  
  const job = { jobId: "job-1", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/job-1-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "post" };
  
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["job-1-carousel-v1.json", { bytes: invalidBytes }]]));
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "render_failed");
  assert.equal(renderer.calls.render, 0);
});

test("valid payload renders and creates manifest", async () => {
  const job = { jobId: "test-001", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/test-001-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "test post" };
  
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["test-001-carousel-v1.json", { bytes: driveBytesTest001 }]]));
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  const result = await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "render_created");
  assert.equal(queue.calls.findEligible, 1);
  assert.equal(queue.calls.persistClaim, 1);
  assert.equal(payload.calls.download, 1);
  assert.equal(renderer.calls.render, 1);
  assert.equal(assets.calls.findManifest, 1);
  assert.equal(assets.calls.store, 1);
  assert.equal(queue.calls.persistState, 1);
  
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "render_created");
  assert.ok(updated.renderManifest.startsWith("cloudinary://"));
  assert.ok(updated.renderManifest.includes("test-001:"));
});

test("renderer receives unique isolated paths", async () => {
  const job = { jobId: "test-001", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/test-001-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "test post" };
  
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["test-001-carousel-v1.json", { bytes: driveBytesTest001 }]]));
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();
  
  let receivedInputPath = "";
  let receivedDistDir = "";
  const renderer = createFakeRenderer(async ({ inputPath, distDir }) => {
    receivedInputPath = inputPath;
    receivedDistDir = distDir;
    return renderCarousel({ inputPath, distDir });
  });

  await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.ok(receivedInputPath.includes("worker-test"));
  assert.ok(receivedDistDir.includes("worker-test"));
  assert.ok(receivedInputPath.endsWith("test-001-carousel-v1.json"));
  assert.notEqual(receivedInputPath, "E:/linkedin-carousel-factory/input/carousel.json");
});

test("existing manifest skips renderer and upload", async () => {
  const { createRunKey, sha256Bytes } = await import("../../src/worker/manifest.js");
  const runKey = createRunKey("test-001", driveBytesTest001);
  
  const existingManifest = {
    schemaVersion: 1,
    jobId: "test-001",
    payloadSha256: sha256Bytes(driveBytesTest001),
    runKey,
    style: { family: "dark-editorial", version: 1 },
    createdAt: "2026-10-07T12:00:00.000Z",
    files: {
      pdf: { name: "carousel.pdf", sha256: "b".repeat(64), bytes: 100, url: "https://cloudinary.com/pdf" },
      cover: { name: "cover.jpg", sha256: "c".repeat(64), bytes: 100, url: "https://cloudinary.com/cover" },
      slides: Array.from({ length: 8 }, (_, i) => ({ name: `slide-${String(i + 1).padStart(2, "0")}.png`, sha256: "d".repeat(64), bytes: 100, url: `https://cloudinary.com/slide${i}` }))
    },
    locator: "cloudinary://" + runKey
  };
  
  const job = { jobId: "test-001", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/test-001-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "test post" };
  
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["test-001-carousel-v1.json", { bytes: driveBytesTest001 }]]));
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore(new Map([[runKey, existingManifest]]));
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  const result = await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "render_created");
  assert.equal(renderer.calls.render, 0);
  assert.equal(assets.calls.store, 0);
  assert.equal(assets.calls.findManifest, 1);
  
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "render_created");
  assert.equal(updated.renderManifest, existingManifest.locator);
});

test("partial assets with matching digest and size are reused", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  // Deterministic stub: identical bytes on every render, so partials match.
  const stubRenderer = (calls) => createFakeRenderer(async ({ inputPath, distDir }) => {
    calls.count++;
    mkdirSync(distDir, { recursive: true });
    const pdf = join(distDir, "carousel.pdf");
    const cover = join(distDir, "cover.jpg");
    writeFileSync(pdf, Buffer.from("pdf-bytes"));
    writeFileSync(cover, Buffer.from("cover-bytes"));
    const slides = [];
    for (let i = 1; i <= 8; i++) {
      const p = join(distDir, `slide-${String(i).padStart(2, "0")}.png`);
      writeFileSync(p, Buffer.from(`slide-${i}-bytes`));
      slides.push(p);
    }
    return { html: join(distDir, "carousel.html"), pdf, cover, slides };
  });

  const makeJob = (rowId) => ({ jobId: "test-001", rowId, status: "carousel_created", carouselFile: "https://drive.google.com/test-001-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "test post" });
  const makePayload = () => createFakePayloadStore(new Map([["test-001-carousel-v1.json", { bytes: driveBytesTest001 }]]));

  // Phase 1: fresh store, full render + upload.
  const calls1 = { count: 0 };
  const queue1 = createFakeQueue([makeJob("Sheet1!2")]);
  const assets1 = createFakeAssetStore();
  const result1 = await runWorker({
    ports: makePorts({ queue: queue1, payload: makePayload(), renderer: stubRenderer(calls1), assets: assets1, drafts: createFakeDraftService() }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test-1"
  });
  assert.equal(result1.outcome, "render_created");

  // Phase 2: new store holding only partial assets (no manifest), digests match.
  const assets2 = createFakeAssetStore();
  assets2.addPartial(result1.manifest.runKey, result1.manifest.files.pdf);
  assets2.addPartial(result1.manifest.runKey, result1.manifest.files.cover);
  for (const slide of result1.manifest.files.slides) assets2.addPartial(result1.manifest.runKey, slide);

  const calls2 = { count: 0 };
  const queue2 = createFakeQueue([makeJob("Sheet1!3")]);
  const result2 = await runWorker({
    ports: makePorts({ queue: queue2, payload: makePayload(), renderer: stubRenderer(calls2), assets: assets2, drafts: createFakeDraftService() }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test-2"
  });

  assert.equal(result2.outcome, "render_created");
  assert.equal(calls2.count, 1);
  assert.equal(result2.manifest.files.pdf.url, result1.manifest.files.pdf.url);
  assert.equal(result2.manifest.files.cover.url, result1.manifest.files.cover.url);
  assert.deepEqual(
    result2.manifest.files.slides.map((s) => s.url),
    result1.manifest.files.slides.map((s) => s.url)
  );
});

test("partial asset with conflicting digest causes terminal render_failed with asset_conflict", async () => {
  const { createRunKey } = await import("../../src/worker/manifest.js");
  const runKey = createRunKey("test-001", driveBytesTest001);

  const job = { jobId: "test-001", rowId: "Sheet1!2", status: "carousel_created", carouselFile: "https://drive.google.com/test-001-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "test post" };

  // No complete manifest: only a stale partial whose digest cannot match.
  const assets = createFakeAssetStore();
  assets.addPartial(runKey, { name: "carousel.pdf", sha256: "0".repeat(64), bytes: 100, url: "https://cloudinary.com/stale-pdf" });

  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["test-001-carousel-v1.json", { bytes: driveBytesTest001 }]]));
  const renderer = createFakeRenderer(renderCarousel);
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  const result = await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "failed");
  assert.equal(renderer.calls.render, 1);
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "render_failed");
  assert.ok(updated.error.includes("asset_conflict"));
});

test("repeating same payload returns same run key", async () => {
  const makeJob = (rowId) => ({ jobId: "test-001", rowId, status: "carousel_created", carouselFile: "https://drive.google.com/test-001-carousel-v1.json", renderAttempts: 0, draftAttempts: 0, lockedAt: "", workerId: "", renderManifest: "", bufferDraftId: "", bufferDraftUrl: "", error: "", updatedAt: new Date().toISOString(), postText: "test post" });
  const makePayload = () => createFakePayloadStore(new Map([["test-001-carousel-v1.json", { bytes: driveBytesTest001 }]]));

  // Shared asset store: second run must find the first run's manifest.
  const assets = createFakeAssetStore();

  const queue = createFakeQueue([makeJob("Sheet1!2")]);
  const renderer = createFakeRenderer(renderCarousel);
  const result1 = await runWorker({
    ports: makePorts({ queue, payload: makePayload(), renderer, assets, drafts: createFakeDraftService() }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test-1"
  });

  const queue2 = createFakeQueue([makeJob("Sheet1!3")]);
  const renderer2 = createFakeRenderer(renderCarousel);
  const result2 = await runWorker({
    ports: makePorts({ queue: queue2, payload: makePayload(), renderer: renderer2, assets, drafts: createFakeDraftService() }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test-2"
  });

  assert.ok(result1.manifest);
  assert.ok(result2.manifest);
  assert.equal(result1.manifest.runKey, result2.manifest.runKey);
  assert.equal(renderer2.calls.render, 0);
});