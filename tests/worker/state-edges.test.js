import assert from "node:assert/strict";
import test from "node:test";
import { stageFor, expiredLockStage, isActionable, STALE_LOCK_MS, MAX_STAGE_ATTEMPTS } from "../../src/worker/job-state.js";
import { runWorker } from "../../src/worker/run-worker.js";
import { createFakeQueue, createFakePayloadStore, createFakeRenderer, createFakeAssetStore, createFakeDraftService, createTestClock } from "../helpers/fake-adapters.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const staleLock = new Date(NOW.getTime() - STALE_LOCK_MS - 1000).toISOString();
const freshLock = new Date(NOW.getTime() - 1000).toISOString();

function row(overrides) {
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

test("carousel_created is gated by render attempts, not draft attempts", () => {
  assert.equal(stageFor(row({ status: "carousel_created", draftAttempts: MAX_STAGE_ATTEMPTS }), NOW), "render");
});

test("a stale lock left by the final attempt is reported as expired, not silently skipped", () => {
  assert.equal(expiredLockStage(row({ status: "rendering", renderAttempts: 3, lockedAt: staleLock }), NOW), "render");
  assert.equal(expiredLockStage(row({ status: "drafting", draftAttempts: 3, lockedAt: staleLock }), NOW), "draft");
  assert.equal(expiredLockStage(row({ status: "rendering", renderAttempts: 3, lockedAt: freshLock }), NOW), null);
  assert.equal(expiredLockStage(row({ status: "rendering", renderAttempts: 2, lockedAt: staleLock }), NOW), null, "still retryable");
  assert.equal(isActionable(row({ status: "rendering", renderAttempts: 3, lockedAt: staleLock }), NOW), true);
  assert.equal(isActionable(row({ status: "draft_created" }), NOW), false);
});

test("the worker marks an expired final-attempt lock as failed without any external call", async () => {
  const queue = createFakeQueue([row({ status: "rendering", renderAttempts: 3, lockedAt: staleLock, workerId: "dead-worker" })]);
  const payload = createFakePayloadStore();
  const renderer = createFakeRenderer(async () => { throw new Error("must not render"); });
  const drafts = createFakeDraftService();

  const result = await runWorker({
    ports: { JobQueue: queue, PayloadStore: payload, CarouselRenderer: renderer, AssetStore: createFakeAssetStore(), DraftService: drafts },
    clock: createTestClock(NOW),
    createWorkerId: () => "worker-edges"
  });

  const updated = queue.getJob("Sheet1!2");
  assert.equal(result.outcome, "failed");
  assert.equal(result.jobId, "job-1");
  assert.equal(result.stage, "render");
  assert.equal(updated.status, "render_failed");
  assert.match(updated.error, /stale_lock_exhausted/);
  assert.equal(updated.workerId, "");
  assert.equal(updated.lockedAt, "");
  assert.equal(updated.renderAttempts, 3, "no new attempt is consumed");
  assert.equal(payload.calls.download, 0);
  assert.equal(renderer.calls.render, 0);
  assert.equal(drafts.calls.findDraft, 0);
});

test("the fake queue applies the same eligibility rules as production", async () => {
  const queue = createFakeQueue([
    row({ rowId: "Sheet1!2", status: "render_retry", renderAttempts: 3 }),
    row({ rowId: "Sheet1!3", jobId: "job-2", status: "draft_failed" })
  ]);
  assert.equal(await queue.findEligible(NOW), null);
});
