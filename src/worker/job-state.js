export const MAX_STAGE_ATTEMPTS = 3;
export const STALE_LOCK_MS = 30 * 60 * 1000;

// Job ids become part of Cloudinary public IDs and the run key.
export const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const renderEligible = new Set(["carousel_created", "render_retry"]);
const draftEligible = new Set(["render_created", "draft_retry"]);
const terminalStatuses = new Set(["render_failed", "draft_failed", "draft_created"]);
const renderStatuses = new Set(["carousel_created", "render_retry", "rendering"]);

function isStaleLock(job, now) {
  if (!job.lockedAt) return false;
  const lockTime = new Date(job.lockedAt);
  if (isNaN(lockTime.getTime())) return false;
  return now.getTime() - lockTime.getTime() >= STALE_LOCK_MS;
}

// A worker that dies during its final permitted attempt leaves the row locked with no
// attempts left. stageFor ignores such rows, so without this they would stay in
// rendering/drafting forever with no visible failure.
export function expiredLockStage(job, now = new Date()) {
  if (!job || (job.status !== "rendering" && job.status !== "drafting")) return null;
  const stage = job.status === "rendering" ? "render" : "draft";
  const attempts = stage === "render" ? job.renderAttempts : job.draftAttempts;
  if (attempts < MAX_STAGE_ATTEMPTS || !isStaleLock(job, now)) return null;
  return stage;
}

export function isActionable(job, now = new Date()) {
  return stageFor(job, now) !== null || expiredLockStage(job, now) !== null;
}

export function stageFor(job, now = new Date()) {
  if (!job || typeof job !== "object") return null;

  const status = job.status;
  const attempts = renderStatuses.has(status) ? job.renderAttempts : job.draftAttempts;

  if (terminalStatuses.has(status)) return null;
  if (attempts >= MAX_STAGE_ATTEMPTS) return null;

  if (renderEligible.has(status)) return "render";
  if (draftEligible.has(status)) return "draft";

  if (status === "rendering" || status === "drafting") {
    return isStaleLock(job, now) ? (status === "rendering" ? "render" : "draft") : null;
  }

  return null;
}

export function claimJob(job, stage, now, workerId) {
  const claimed = { ...job };
  claimed.workerId = workerId;
  claimed.lockedAt = now.toISOString();
  claimed.error = "";

  if (stage === "render") {
    claimed.status = "rendering";
    claimed.renderAttempts = (claimed.renderAttempts || 0) + 1;
  } else if (stage === "draft") {
    claimed.status = "drafting";
    claimed.draftAttempts = (claimed.draftAttempts || 0) + 1;
  }

  return claimed;
}

export function failureTransition(job, stage, error) {
  const failed = { ...job };
  failed.error = error.message || error.code || "Unknown error";
  failed.workerId = "";
  failed.lockedAt = "";

  const isValidation = error.type === "validation";
  const isAssetConflict = error.type === "asset_conflict";
  const isTerminalConfig = error.type === "configuration" || error.type === "data_integrity";

  const attempts = stage === "render" ? failed.renderAttempts : failed.draftAttempts;
  const isFinalAttempt = attempts >= MAX_STAGE_ATTEMPTS;

  if (stage === "render") {
    if (isValidation || isAssetConflict || isTerminalConfig || isFinalAttempt) {
      failed.status = "render_failed";
    } else {
      failed.status = "render_retry";
    }
  } else {
    if (isValidation || isTerminalConfig || isFinalAttempt) {
      failed.status = "draft_failed";
    } else {
      failed.status = "draft_retry";
    }
  }

  return failed;
}
// Buffer drafts can only be reconciled by caption, and the caption is the Sheet post_text.
// Two rows with the same post_text could therefore adopt each other's draft, so such rows
// are reported and stopped for a human instead of guessed at.
export function findDuplicatePostTextRows(job, jobs) {
  const text = String(job?.postText ?? "").trim();
  if (!text) return [];
  return jobs
    .filter((other) => other.rowId !== job.rowId && String(other.postText ?? "").trim() === text)
    .map((other) => other.rowId);
}
