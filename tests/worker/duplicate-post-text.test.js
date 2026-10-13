import assert from "node:assert/strict";
import test from "node:test";
import { runWorker } from "../../src/worker/run-worker.js";
import { findDuplicatePostTextRows } from "../../src/worker/job-state.js";
import { createManifestDraft } from "../../src/worker/manifest.js";
import { createFakeQueue, createFakePayloadStore, createFakeRenderer, createFakeAssetStore, createFakeDraftService, createTestClock } from "../helpers/fake-adapters.js";

const SHARED_POST = "Your launch video should make people care before it explains anything.";

function row(overrides) {
  return {
    jobId: "job-a",
    rowId: "Sheet1!2",
    status: "carousel_created",
    carouselFile: "https://drive.google.com/job-a-carousel-v1.json",
    renderAttempts: 0,
    draftAttempts: 0,
    lockedAt: "",
    workerId: "",
    renderManifest: "",
    bufferDraftId: "",
    bufferDraftUrl: "",
    error: "",
    postText: SHARED_POST,
    ...overrides
  };
}

async function storedManifest(jobId) {
  const draft = await createManifestDraft({
    jobId,
    payloadBytes: Buffer.from(`payload-${jobId}`),
    outputs: {
      pdf: { name: "carousel.pdf", bytes: Buffer.from(`pdf-${jobId}`) },
      cover: { name: "cover.jpg", bytes: Buffer.from(`cover-${jobId}`) },
      slides: Array.from({ length: 8 }, (_, i) => ({ name: `slide-0${i + 1}.png`, bytes: Buffer.from(`s${i}-${jobId}`) }))
    },
    now: new Date("2026-10-07T12:00:00.000Z")
  });
  draft.files.pdf.url = `https://res.cloudinary.com/demo/raw/upload/${jobId}/carousel.pdf`;
  draft.files.cover.url = `https://res.cloudinary.com/demo/image/upload/${jobId}/cover`;
  draft.files.slides.forEach((slide, i) => { slide.url = `https://res.cloudinary.com/demo/image/upload/${jobId}/slide-${i}`; });
  return { ...draft, locator: `cloudinary://${draft.runKey}` };
}

async function run(queue, { assets = createFakeAssetStore(), drafts = createFakeDraftService(), payload = createFakePayloadStore() } = {}) {
  const renderer = createFakeRenderer(async () => { throw new Error("renderer must not run"); });
  const result = await runWorker({
    ports: { JobQueue: queue, PayloadStore: payload, CarouselRenderer: renderer, AssetStore: assets, DraftService: drafts },
    clock: createTestClock(),
    createWorkerId: () => "worker-dup"
  });
  return { result, renderer, drafts, payload };
}

test("findDuplicatePostTextRows compares trimmed post text across every other row", () => {
  const jobs = [
    row({ rowId: "Sheet1!2" }),
    row({ rowId: "Sheet1!3", postText: `  ${SHARED_POST}\n` }),
    row({ rowId: "Sheet1!4", postText: "A different post." }),
    row({ rowId: "Sheet1!5", postText: "" }),
    row({ rowId: "Sheet1!6", postText: "   " })
  ];
  assert.deepEqual(findDuplicatePostTextRows(jobs[0], jobs), ["Sheet1!3"]);
  assert.deepEqual(findDuplicatePostTextRows(jobs[2], jobs), []);
  assert.deepEqual(findDuplicatePostTextRows(jobs[3], jobs), [], "empty post text is not a duplicate signal");
});

test("wrong-row regression: job B never adopts job A's Buffer draft when both rows share a caption", async () => {
  const manifestB = await storedManifest("job-b");
  const assets = createFakeAssetStore();
  assets.addManifest(manifestB.runKey, manifestB);
  const drafts = createFakeDraftService();
  drafts.addDraft({ id: "draft-of-a", url: "", caption: SHARED_POST });
  const queue = createFakeQueue([
    row({ jobId: "job-a", rowId: "Sheet1!2", status: "draft_created", bufferDraftId: "draft-of-a" }),
    row({ jobId: "job-b", rowId: "Sheet1!3", status: "render_created", renderAttempts: 1, renderManifest: manifestB.locator })
  ]);

  await run(queue, { assets, drafts });

  const b = queue.getJob("Sheet1!3");
  assert.notEqual(b.bufferDraftId, "draft-of-a");
  assert.equal(b.status, "draft_failed");
  assert.match(b.error, /^validation:duplicate_post_text /);
  assert.equal(drafts.calls.findDraft, 0, "no caption lookup may run for a duplicated post");
  assert.equal(drafts.calls.createDraft, 0);
});

test("a duplicated post is stopped before download and render", async () => {
  const queue = createFakeQueue([
    row({ jobId: "job-a", rowId: "Sheet1!2", status: "draft_created", bufferDraftId: "draft-of-a" }),
    row({ jobId: "job-b", rowId: "Sheet1!3", carouselFile: "https://drive.google.com/job-b-carousel-v1.json" })
  ]);

  const { renderer, payload } = await run(queue);

  const b = queue.getJob("Sheet1!3");
  assert.equal(b.status, "render_failed");
  assert.match(b.error, /^validation:duplicate_post_text .*Sheet1!2/);
  assert.equal(payload.calls.download, 0);
  assert.equal(renderer.calls.render, 0);
});

test("a stored draft id is still trusted for a duplicated post", async () => {
  const manifestB = await storedManifest("job-b");
  const assets = createFakeAssetStore();
  assets.addManifest(manifestB.runKey, manifestB);
  const drafts = createFakeDraftService();
  drafts.addDraft({ id: "draft-of-b", url: "", caption: SHARED_POST });
  const queue = createFakeQueue([
    row({ jobId: "job-a", rowId: "Sheet1!2", status: "draft_created", bufferDraftId: "draft-of-a" }),
    row({ jobId: "job-b", rowId: "Sheet1!3", status: "draft_retry", renderAttempts: 1, draftAttempts: 1, renderManifest: manifestB.locator, bufferDraftId: "draft-of-b" })
  ]);

  await run(queue, { assets, drafts });

  const b = queue.getJob("Sheet1!3");
  assert.equal(b.status, "draft_created");
  assert.equal(b.bufferDraftId, "draft-of-b");
});
