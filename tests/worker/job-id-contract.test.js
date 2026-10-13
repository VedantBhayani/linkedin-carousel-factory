import assert from "node:assert/strict";
import test from "node:test";
import { runWorker } from "../../src/worker/run-worker.js";
import { createFakeQueue, createFakeRenderer, createFakeAssetStore, createFakeDraftService, createTestClock } from "../helpers/fake-adapters.js";

const style = { family: "dark-editorial", accent: "electric-blue", density: "low" };
const slides = Array.from({ length: 8 }, (_, i) => ({ layout: "statement", headline: `Slide ${i + 1}` }));

function payloadBytes(jobId) {
  return new TextEncoder().encode(JSON.stringify({ jobId, title: "Test", style, slides }));
}

function makeJob(jobId) {
  return {
    jobId,
    rowId: "Sheet1!6",
    status: "carousel_created",
    carouselFile: "https://drive.google.com/file/d/abcdefghijkl/view",
    renderAttempts: 0,
    draftAttempts: 0,
    lockedAt: "",
    workerId: "",
    renderManifest: "",
    bufferDraftId: "",
    bufferDraftUrl: "",
    error: "",
    postText: "post"
  };
}

function fixedPayload(fileName, bytes) {
  return { calls: { download: 0 }, async download() { this.calls.download++; return { fileName, bytes }; } };
}

function fakeRender() {
  return createFakeRenderer(async ({ distDir }) => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(distDir, { recursive: true });
    const write = (name) => { const p = join(distDir, name); writeFileSync(p, `bytes-${name}`); return p; };
    return {
      html: write("carousel.html"),
      pdf: write("carousel.pdf"),
      cover: write("cover.jpg"),
      slides: Array.from({ length: 8 }, (_, i) => write(`slide-0${i + 1}.png`))
    };
  });
}

async function run(job, payload) {
  const queue = createFakeQueue([job]);
  const renderer = fakeRender();
  const result = await runWorker({
    ports: {
      JobQueue: queue,
      PayloadStore: payload,
      CarouselRenderer: renderer,
      AssetStore: createFakeAssetStore(),
      DraftService: createFakeDraftService()
    },
    clock: createTestClock(),
    createWorkerId: () => "worker-jobid"
  });
  return { result, row: queue.getJob(job.rowId), renderer };
}

test("leading space kept by the AI in the Drive filename and JSON jobId still renders (live-001 regression)", async () => {
  const { row, renderer } = await run(
    makeJob("live-001"),
    fixedPayload(" live-001-carousel-v1.json", payloadBytes(" live-001"))
  );
  assert.equal(renderer.calls.render, 1);
  assert.equal(row.status, "draft_created");
});

test("trailing whitespace in the filename and JSON jobId is tolerated", async () => {
  const { row } = await run(
    makeJob("live-001"),
    fixedPayload("live-001-carousel-v1.json ", payloadBytes("live-001\t"))
  );
  assert.equal(row.status, "draft_created");
});

test("run key and asset paths use the trimmed job id", async () => {
  const { result } = await run(
    makeJob("live-001"),
    fixedPayload(" live-001-carousel-v1.json", payloadBytes(" live-001"))
  );
  assert.match(result.manifest.runKey, /^live-001:[a-f0-9]{64}$/);
  assert.equal(result.manifest.jobId, "live-001");
});

test("a different job id is still rejected after trimming", async () => {
  const { row, renderer } = await run(
    makeJob("live-001"),
    fixedPayload("live-001-carousel-v1.json", payloadBytes(" live-002"))
  );
  assert.equal(row.status, "render_failed");
  assert.match(row.error, /jobid_mismatch/);
  assert.equal(renderer.calls.render, 0);
});

test("job ids unsafe for storage paths are rejected as validation errors before download", async () => {
  for (const jobId of ["live/001", "live 001", "../live-001", "live:001"]) {
    const payload = fixedPayload(`${jobId}-carousel-v1.json`, payloadBytes(jobId));
    const { row, renderer } = await run(makeJob(jobId), payload);
    assert.equal(row.status, "render_failed", jobId);
    assert.match(row.error, /validation:invalid_job_id/, jobId);
    assert.equal(payload.calls.download, 0, jobId);
    assert.equal(renderer.calls.render, 0, jobId);
  }
});
