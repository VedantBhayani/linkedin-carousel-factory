import assert from "node:assert/strict";
import test from "node:test";
import { stageFor, claimJob, failureTransition, MAX_STAGE_ATTEMPTS, STALE_LOCK_MS } from "../../src/worker/job-state.js";

const now = new Date("2026-10-07T12:00:00.000Z");
const recentLock = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
const staleLock = new Date(now.getTime() - 35 * 60 * 1000).toISOString();
const futureLock = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

const baseRenderJob = {
  jobId: "test-001",
  rowId: "Sheet1!2",
  postText: "test post",
  status: "carousel_created",
  carouselFile: "https://drive.google.com/...",
  renderAttempts: 0,
  draftAttempts: 0,
  lockedAt: "",
  workerId: "",
  renderManifest: "",
  bufferDraftId: "",
  bufferDraftUrl: "",
  error: "",
  updatedAt: now.toISOString()
};

const baseDraftJob = {
  ...baseRenderJob,
  status: "render_created",
  renderAttempts: 1,
  renderManifest: "https://cloudinary.com/.../manifest.json"
};

test("stageFor returns render for carousel_created", () => {
  assert.equal(stageFor(baseRenderJob, now), "render");
});

test("stageFor returns render for render_retry", () => {
  const job = { ...baseRenderJob, status: "render_retry" };
  assert.equal(stageFor(job, now), "render");
});

test("stageFor returns render for stale rendering lock", () => {
  const job = { ...baseRenderJob, status: "rendering", lockedAt: staleLock };
  assert.equal(stageFor(job, now), "render");
});

test("stageFor returns null for fresh rendering lock", () => {
  const job = { ...baseRenderJob, status: "rendering", lockedAt: recentLock };
  assert.equal(stageFor(job, now), null);
});

test("stageFor returns null for future rendering lock", () => {
  const job = { ...baseRenderJob, status: "rendering", lockedAt: futureLock };
  assert.equal(stageFor(job, now), null);
});

test("stageFor returns draft for render_created", () => {
  assert.equal(stageFor(baseDraftJob, now), "draft");
});

test("stageFor returns draft for draft_retry", () => {
  const job = { ...baseDraftJob, status: "draft_retry" };
  assert.equal(stageFor(job, now), "draft");
});

test("stageFor returns draft for stale drafting lock", () => {
  const job = { ...baseDraftJob, status: "drafting", lockedAt: staleLock };
  assert.equal(stageFor(job, now), "draft");
});

test("stageFor returns null for fresh drafting lock", () => {
  const job = { ...baseDraftJob, status: "drafting", lockedAt: recentLock };
  assert.equal(stageFor(job, now), null);
});

test("stageFor returns null for completed draft_created", () => {
  const job = { ...baseDraftJob, status: "draft_created" };
  assert.equal(stageFor(job, now), null);
});

test("stageFor returns null for terminal render_failed", () => {
  const job = { ...baseRenderJob, status: "render_failed" };
  assert.equal(stageFor(job, now), null);
});

test("stageFor returns null for terminal draft_failed", () => {
  const job = { ...baseDraftJob, status: "draft_failed" };
  assert.equal(stageFor(job, now), null);
});

test("stageFor rejects exhausted render attempts", () => {
  const job = { ...baseRenderJob, status: "render_retry", renderAttempts: 3 };
  assert.equal(stageFor(job, now), null);
});

test("stageFor rejects exhausted draft attempts", () => {
  const job = { ...baseDraftJob, status: "draft_retry", draftAttempts: 3 };
  assert.equal(stageFor(job, now), null);
});

test("stageFor rejects unknown status", () => {
  const job = { ...baseRenderJob, status: "unknown_status" };
  assert.equal(stageFor(job, now), null);
});

test("claimJob increments renderAttempts and sets rendering state", () => {
  const claimed = claimJob(baseRenderJob, "render", now, "worker-1");
  assert.equal(claimed.status, "rendering");
  assert.equal(claimed.renderAttempts, 1);
  assert.equal(claimed.lockedAt, now.toISOString());
  assert.equal(claimed.workerId, "worker-1");
  assert.equal(claimed.error, "");
});

test("claimJob increments draftAttempts and sets drafting state", () => {
  const claimed = claimJob(baseDraftJob, "draft", now, "worker-1");
  assert.equal(claimed.status, "drafting");
  assert.equal(claimed.draftAttempts, 1);
  assert.equal(claimed.lockedAt, now.toISOString());
  assert.equal(claimed.workerId, "worker-1");
});

test("claimJob preserves source fields", () => {
  const claimed = claimJob(baseRenderJob, "render", now, "worker-1");
  assert.equal(claimed.jobId, baseRenderJob.jobId);
  assert.equal(claimed.postText, baseRenderJob.postText);
  assert.equal(claimed.carouselFile, baseRenderJob.carouselFile);
  assert.equal(claimed.rowId, baseRenderJob.rowId);
});

test("failureTransition maps recoverable to retry state", () => {
  const claimed = claimJob(baseRenderJob, "render", now, "worker-1");
  const error = { type: "external", code: "timeout", message: "Drive timeout" };
  const failed = failureTransition(claimed, "render", error);
  assert.equal(failed.status, "render_retry");
  assert.equal(failed.renderAttempts, 1);
  assert.ok(failed.error.includes("timeout"));
});

test("failureTransition maps validation to terminal render_failed", () => {
  const error = { type: "validation", code: "invalid_json", message: "Bad JSON" };
  const failed = failureTransition(baseRenderJob, "render", error);
  assert.equal(failed.status, "render_failed");
});

test("failureTransition maps asset_conflict to terminal render_failed", () => {
  const error = { type: "asset_conflict", code: "asset_conflict", message: "Digest mismatch" };
  const failed = failureTransition(baseRenderJob, "render", error);
  assert.equal(failed.status, "render_failed");
});

test("failureTransition third attempt becomes terminal", () => {
  const job = { ...baseRenderJob, renderAttempts: 3 };
  const error = { type: "external", code: "timeout", message: "Drive timeout" };
  const failed = failureTransition(job, "render", error);
  assert.equal(failed.status, "render_failed");
});

test("failureTransition third draft attempt becomes terminal", () => {
  const job = { ...baseDraftJob, draftAttempts: 3 };
  const error = { type: "external", code: "timeout", message: "Buffer timeout" };
  const failed = failureTransition(job, "draft", error);
  assert.equal(failed.status, "draft_failed");
});

test("failureTransition draft stage uses draft_retry", () => {
  const claimed = claimJob(baseDraftJob, "draft", now, "worker-1");
  const error = { type: "external", code: "buffer_error", message: "Buffer API error" };
  const failed = failureTransition(claimed, "draft", error);
  assert.equal(failed.status, "draft_retry");
  assert.equal(failed.draftAttempts, 1);
});

test("MAX_STAGE_ATTEMPTS is 3", () => {
  assert.equal(MAX_STAGE_ATTEMPTS, 3);
});

test("STALE_LOCK_MS is 30 minutes", () => {
  assert.equal(STALE_LOCK_MS, 30 * 60 * 1000);
});

test("claimJob handles malformed timestamp gracefully", () => {
  const job = { ...baseRenderJob, lockedAt: "not-a-date" };
  const claimed = claimJob(job, "render", now, "worker-1");
  assert.equal(claimed.status, "rendering");
});