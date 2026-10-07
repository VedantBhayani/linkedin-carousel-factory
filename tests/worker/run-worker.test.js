import assert from "node:assert/strict";
import test from "node:test";
import { runWorker } from "../../src/worker/run-worker.js";
import { WorkerError } from "../../src/worker/errors.js";
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

  assert.equal(queue.calls.persistClaim, 2);
  const claimedJob = queue.getJob("Sheet1!2");
  assert.equal(claimedJob.status, "draft_created");
  assert.equal(claimedJob.renderAttempts, 1);
  assert.equal(claimedJob.draftAttempts, 1);
  assert.equal(claimedJob.workerId, "");
  const untouchedJob = queue.getJob("Sheet1!3");
  assert.equal(untouchedJob.status, "carousel_created");
  assert.equal(untouchedJob.renderAttempts, 0);
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

  assert.equal(result.outcome, "draft_created");
  assert.equal(queue.calls.findEligible, 1);
  assert.equal(queue.calls.persistClaim, 2);
  assert.equal(payload.calls.download, 1);
  assert.equal(renderer.calls.render, 1);
  assert.equal(assets.calls.findManifest, 1);
  assert.equal(assets.calls.store, 1);
  assert.equal(queue.calls.persistState, 2);
  assert.equal(drafts.calls.findDraft, 1);
  assert.equal(drafts.calls.createDraft, 1);

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "draft_created");
  assert.ok(updated.renderManifest.startsWith("cloudinary://"));
  assert.ok(updated.renderManifest.includes("test-001:"));
  assert.ok(updated.bufferDraftId.length > 0);
  assert.ok(updated.bufferDraftUrl.startsWith("https://buffer.com/draft/"));
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

  assert.equal(result.outcome, "draft_created");
  assert.equal(renderer.calls.render, 0);
  assert.equal(assets.calls.store, 0);
  assert.equal(assets.calls.findManifest, 1);
  assert.equal(drafts.calls.createDraft, 1);

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "draft_created");
  assert.equal(updated.renderManifest, existingManifest.locator);
  assert.ok(updated.bufferDraftId.length > 0);
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
  assert.equal(result1.outcome, "draft_created");

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

  assert.equal(result2.outcome, "draft_created");
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

async function buildStoredManifest(jobId, payloadBytes, pdfUrl = "https://cloudinary.com/test-pdf") {
  const { createManifestDraft } = await import("../../src/worker/manifest.js");
  const draft = await createManifestDraft({
    jobId,
    payloadBytes,
    outputs: {
      pdf: { name: "carousel.pdf", bytes: Buffer.from("pdf-bytes") },
      cover: { name: "cover.jpg", bytes: Buffer.from("cover-bytes") },
      slides: Array.from({ length: 8 }, (_, i) => ({ name: `slide-${String(i + 1).padStart(2, "0")}.png`, bytes: Buffer.from(`slide-${i}-bytes`) }))
    },
    now: new Date("2026-10-07T12:00:00.000Z")
  });
  draft.files.pdf.url = pdfUrl;
  draft.files.cover.url = "https://cloudinary.com/test-cover";
  draft.files.slides.forEach((s, i) => { s.url = `https://cloudinary.com/test-slide${i}`; });
  const locator = `cloudinary://${draft.runKey}`;
  return { manifest: { ...draft, locator }, locator };
}

function makeDraftOnlyJob(overrides = {}) {
  return {
    jobId: "test-001",
    rowId: "Sheet1!2",
    status: "render_created",
    carouselFile: "https://drive.google.com/test-001-carousel-v1.json",
    renderAttempts: 1,
    draftAttempts: 0,
    lockedAt: "",
    workerId: "",
    renderManifest: "",
    bufferDraftId: "",
    bufferDraftUrl: "",
    error: "",
    updatedAt: new Date().toISOString(),
    postText: "exact unmodified post text",
    ...overrides
  };
}

test("fresh render persists render_created then drafting claim before any Buffer call", async () => {
  const job = { ...makeDraftOnlyJob(), status: "carousel_created", renderAttempts: 0, renderManifest: "" };
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore(new Map([["test-001-carousel-v1.json", { bytes: driveBytesTest001 }]]));
  const renderer = createFakeRenderer(renderCarousel);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();

  const states = [];
  const originalPersistState = queue.persistState.bind(queue);
  queue.persistState = async (rowId, updates) => {
    if (updates.status) states.push(updates.status);
    return originalPersistState(rowId, updates);
  };
  let claimsAtFirstBufferCall = -1;
  const originalFindDraft = drafts.findDraft.bind(drafts);
  drafts.findDraft = async (...args) => {
    if (claimsAtFirstBufferCall === -1) claimsAtFirstBufferCall = queue.calls.persistClaim;
    return originalFindDraft(...args);
  };

  const clock = createTestClock();
  const result = await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "draft_created");
  assert.deepEqual(states, ["render_created", "draft_created"]);
  assert.equal(queue.calls.persistClaim, 2);
  assert.equal(claimsAtFirstBufferCall, 2);
  assert.equal(drafts.calls.createDraft, 1);
});

test("draft-only job claims once without double increment", async () => {
  const { locator } = await buildStoredManifest("test-001", driveBytesTest001);
  const job = makeDraftOnlyJob({ renderManifest: locator });
  const assets = createFakeAssetStore();
  const { manifest } = await buildStoredManifest("test-001", driveBytesTest001);
  assets.addManifest(manifest.runKey, manifest);

  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore();
  const renderer = createFakeRenderer(renderCarousel);
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  const result = await runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "draft_created");
  assert.equal(queue.calls.persistClaim, 1);
  assert.equal(payload.calls.download, 0);
  assert.equal(renderer.calls.render, 0);
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.draftAttempts, 1);
  assert.equal(updated.renderAttempts, 1);
  assert.equal(updated.status, "draft_created");
});

test("invalid stored manifest becomes terminal draft_failed with no Buffer call", async () => {
  const job = makeDraftOnlyJob({ renderManifest: "cloudinary://missing-manifest" });
  const queue = createFakeQueue([job]);
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();
  const clock = createTestClock();

  const result = await runWorker({
    ports: makePorts({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts }),
    clock,
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "failed");
  assert.equal(drafts.calls.findDraft, 0);
  assert.equal(drafts.calls.createDraft, 0);
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "draft_failed");
  assert.ok(updated.error.includes("invalid_render_manifest"));
});

test("malformed stored manifest becomes terminal draft_failed", async () => {
  const assets = createFakeAssetStore();
  assets.addManifest("bogus-key", { garbage: true });
  const job = makeDraftOnlyJob({ renderManifest: "cloudinary://bogus-key" });
  const queue = createFakeQueue([job]);
  const drafts = createFakeDraftService();

  await runWorker({
    ports: makePorts({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "draft_failed");
  assert.ok(updated.error.includes("invalid_render_manifest"));
  assert.equal(drafts.calls.createDraft, 0);
});

test("stored draft id is reconciled first", async () => {
  const { manifest, locator } = await buildStoredManifest("test-001", driveBytesTest001);
  const assets = createFakeAssetStore();
  assets.addManifest(manifest.runKey, manifest);
  const drafts = createFakeDraftService();
  drafts.addDraft({ id: "stored-d1", url: "https://buffer.com/draft/stored-d1", runKey: "some-other-run-key", caption: "old", pdfUrl: "old" });

  const job = makeDraftOnlyJob({ renderManifest: locator, bufferDraftId: "stored-d1" });
  const queue = createFakeQueue([job]);

  const result = await runWorker({
    ports: makePorts({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "draft_created");
  assert.equal(drafts.calls.createDraft, 0);
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.bufferDraftId, "stored-d1");
  assert.equal(updated.bufferDraftUrl, "https://buffer.com/draft/stored-d1");
});

test("existing draft by run key is reused", async () => {
  const { manifest, locator } = await buildStoredManifest("test-001", driveBytesTest001);
  const assets = createFakeAssetStore();
  assets.addManifest(manifest.runKey, manifest);
  const drafts = createFakeDraftService();
  drafts.addDraft({ id: "runkey-d1", url: "https://buffer.com/draft/runkey-d1", runKey: manifest.runKey, caption: "old", pdfUrl: "old" });

  const job = makeDraftOnlyJob({ renderManifest: locator });
  const queue = createFakeQueue([job]);

  await runWorker({
    ports: makePorts({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });

  assert.equal(drafts.calls.createDraft, 0);
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "draft_created");
  assert.equal(updated.bufferDraftId, "runkey-d1");
});

test("missing draft is created once with exact postText and verified pdf url", async () => {
  const { manifest, locator } = await buildStoredManifest("test-001", driveBytesTest001, "https://cloudinary.com/verified-pdf");
  const assets = createFakeAssetStore();
  assets.addManifest(manifest.runKey, manifest);
  const drafts = createFakeDraftService();

  const job = makeDraftOnlyJob({ renderManifest: locator, postText: "word-for-word caption" });
  const queue = createFakeQueue([job]);

  const result = await runWorker({
    ports: makePorts({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "draft_created");
  assert.equal(drafts.calls.createDraft, 1);
  assert.equal(drafts.lastCreate.caption, "word-for-word caption");
  assert.equal(drafts.lastCreate.pdfUrl, "https://cloudinary.com/verified-pdf");
  assert.equal(drafts.lastCreate.coverUrl, "https://cloudinary.com/test-cover");
  assert.equal(drafts.lastCreate.runKey, manifest.runKey);
});

test("ambiguous create enters draft_retry without a second create call", async () => {
  const { manifest, locator } = await buildStoredManifest("test-001", driveBytesTest001);
  const assets = createFakeAssetStore();
  assets.addManifest(manifest.runKey, manifest);
  const drafts = createFakeDraftService();
  drafts.ambiguousOnCreate = true;

  const job = makeDraftOnlyJob({ renderManifest: locator });
  const queue = createFakeQueue([job]);

  const result = await runWorker({
    ports: makePorts({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });

  assert.equal(result.outcome, "failed");
  assert.equal(drafts.calls.createDraft, 1);
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "draft_retry");
  assert.ok(updated.error.includes("buffer_ambiguous"));
});

test("typed draft creation failures preserve the adapter error details", async () => {
  const { manifest, locator } = await buildStoredManifest("test-001", driveBytesTest001);
  const assets = createFakeAssetStore();
  assets.addManifest(manifest.runKey, manifest);
  const drafts = createFakeDraftService();
  drafts.createError = new WorkerError("external", "buffer_http_error", "Buffer HTTP 401");

  const job = makeDraftOnlyJob({ renderManifest: locator });
  const queue = createFakeQueue([job]);

  const result = await runWorker({
    ports: makePorts({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });

  assert.deepEqual(result, { outcome: "failed", error: "buffer_http_error" });
  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "draft_retry");
  assert.equal(updated.error, "external:buffer_http_error Buffer HTTP 401");
});

async function runWorkerOnce({ queue, payload, renderer, assets, drafts }) {
  return runWorker({
    ports: makePorts({ queue, payload, renderer, assets, drafts }),
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });
}

test("render retry: attempt one failure becomes render_retry", async () => {
  const job = makeDraftOnlyJob({ status: "carousel_created", renderAttempts: 0, renderManifest: "" });
  const other = makeDraftOnlyJob({ rowId: "Sheet1!9", jobId: "other-1", status: "carousel_created", renderAttempts: 0, renderManifest: "" });
  const queue = createFakeQueue([job, other]);
  const payload = createFakePayloadStore();

  await runWorkerOnce({ queue, payload, renderer: createFakeRenderer(renderCarousel), assets: createFakeAssetStore(), drafts: createFakeDraftService() });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "render_retry");
  assert.equal(updated.renderAttempts, 1);
  const untouched = queue.getJob("Sheet1!9");
  assert.equal(untouched.status, "carousel_created");
  assert.equal(untouched.renderAttempts, 0);
});

test("render retry: attempt two stays retryable, attempt three is terminal", async () => {
  const job = makeDraftOnlyJob({ status: "carousel_created", renderAttempts: 0, renderManifest: "" });
  const queue = createFakeQueue([job]);
  const payload = createFakePayloadStore();
  const assets = createFakeAssetStore();
  const drafts = createFakeDraftService();

  await runWorkerOnce({ queue, payload, renderer: createFakeRenderer(renderCarousel), assets, drafts });
  assert.equal(queue.getJob("Sheet1!2").status, "render_retry");

  await runWorkerOnce({ queue, payload, renderer: createFakeRenderer(renderCarousel), assets, drafts });
  const second = queue.getJob("Sheet1!2");
  assert.equal(second.status, "render_retry");
  assert.equal(second.renderAttempts, 2);

  await runWorkerOnce({ queue, payload, renderer: createFakeRenderer(renderCarousel), assets, drafts });
  const third = queue.getJob("Sheet1!2");
  assert.equal(third.status, "render_failed");
  assert.equal(third.renderAttempts, 3);
});

test("draft retry: three recoverable failures end in draft_failed", async () => {
  const { locator } = await buildStoredManifest("test-001", driveBytesTest001);
  const job = makeDraftOnlyJob({ renderManifest: locator });
  const queue = createFakeQueue([job]);
  const assets = createFakeAssetStore();
  const { manifest } = await buildStoredManifest("test-001", driveBytesTest001);
  assets.addManifest(manifest.runKey, manifest);
  const drafts = createFakeDraftService();
  drafts.createError = new WorkerError("external", "buffer_down", "Buffer API unavailable");

  const run = () => runWorkerOnce({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts });

  await run();
  assert.equal(queue.getJob("Sheet1!2").status, "draft_retry");
  await run();
  const second = queue.getJob("Sheet1!2");
  assert.equal(second.status, "draft_retry");
  assert.equal(second.draftAttempts, 2);
  await run();
  const third = queue.getJob("Sheet1!2");
  assert.equal(third.status, "draft_failed");
  assert.equal(third.draftAttempts, 3);
});

test("stale rendering lock is reclaimed as a new render attempt", async () => {
  const base = new Date("2026-10-07T12:00:00.000Z").getTime();
  const stale = new Date(base - 45 * 60 * 1000).toISOString();
  const job = makeDraftOnlyJob({ status: "rendering", lockedAt: stale, workerId: "dead-worker", renderAttempts: 0, renderManifest: "" });
  const queue = createFakeQueue([job]);

  await runWorkerOnce({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets: createFakeAssetStore(), drafts: createFakeDraftService() });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.renderAttempts, 1);
  assert.equal(updated.status, "render_retry");
  assert.equal(updated.workerId, "");
});

test("stale drafting lock is reclaimed as a new draft attempt", async () => {
  const { locator } = await buildStoredManifest("test-001", driveBytesTest001);
  const { manifest } = await buildStoredManifest("test-001", driveBytesTest001);
  const assets = createFakeAssetStore();
  assets.addManifest(manifest.runKey, manifest);
  const drafts = createFakeDraftService();
  drafts.createError = new WorkerError("external", "buffer_down", "Buffer API unavailable");

  const base = new Date("2026-10-07T12:00:00.000Z").getTime();
  const stale = new Date(base - 45 * 60 * 1000).toISOString();
  const job = makeDraftOnlyJob({ status: "drafting", lockedAt: stale, workerId: "dead-worker", renderManifest: locator });
  const queue = createFakeQueue([job]);

  await runWorkerOnce({ queue, payload: createFakePayloadStore(), renderer: createFakeRenderer(renderCarousel), assets, drafts });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.draftAttempts, 1);
  assert.equal(updated.status, "draft_retry");
});

test("fresh locks produce idle behavior with no writes", async () => {
  const base = new Date("2026-10-07T12:00:00.000Z").getTime();
  const recent = new Date(base - 5 * 60 * 1000).toISOString();
  const rendering = makeDraftOnlyJob({ status: "rendering", lockedAt: recent, workerId: "active-worker", renderAttempts: 1, renderManifest: "" });
  const drafting = makeDraftOnlyJob({ rowId: "Sheet1!3", status: "drafting", lockedAt: recent, workerId: "active-worker", renderManifest: "cloudinary://x" });
  const queue = createFakeQueue([rendering, drafting]);
  const payload = createFakePayloadStore();
  const renderer = createFakeRenderer(renderCarousel);

  const result = await runWorkerOnce({ queue, payload, renderer, assets: createFakeAssetStore(), drafts: createFakeDraftService() });

  assert.equal(result.outcome, "idle");
  assert.equal(queue.calls.persistClaim, 0);
  assert.equal(queue.calls.persistState, 0);
  assert.equal(payload.calls.download, 0);
  assert.equal(renderer.calls.render, 0);
});

test("configuration failure happens before any job is claimed", async () => {
  const job = makeDraftOnlyJob({ status: "carousel_created", renderManifest: "" });
  const queue = createFakeQueue([job]);
  const ports = makePorts({
    queue,
    payload: createFakePayloadStore(),
    renderer: createFakeRenderer(renderCarousel),
    assets: createFakeAssetStore(),
    drafts: createFakeDraftService()
  });
  delete ports.DraftService.createDraft;

  await assert.rejects(
    runWorker({ ports, clock: createTestClock(), createWorkerId: () => "worker-test" }),
    /DraftService missing methods/
  );
  assert.equal(queue.calls.findEligible, 0);
  assert.equal(queue.calls.persistClaim, 0);
});

test("queue errors are sanitized and row-scoped", async () => {
  const job = makeDraftOnlyJob({ status: "carousel_created", renderAttempts: 0, renderManifest: "" });
  const other = makeDraftOnlyJob({ rowId: "Sheet1!9", jobId: "other-1", status: "carousel_created" });
  const queue = createFakeQueue([job, other]);
  const payload = createFakePayloadStore();
  const secretUrl = "https://drive.google.com/file/d/secret123/view?usp=sharing";
  const originalDownload = payload.download.bind(payload);
  payload.download = async () => {
    throw new WorkerError("external", "drive_timeout", `GET ${secretUrl} timed out after 30s`);
  };
  void originalDownload;

  await runWorkerOnce({ queue, payload, renderer: createFakeRenderer(renderCarousel), assets: createFakeAssetStore(), drafts: createFakeDraftService() });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(updated.status, "render_retry");
  assert.ok(!updated.error.includes("https://"));
  assert.ok(!updated.error.includes("secret123"));
  assert.ok(updated.error.includes("drive_timeout"));
  const untouched = queue.getJob("Sheet1!9");
  assert.equal(untouched.status, "carousel_created");
  assert.equal(untouched.error, "");
});
