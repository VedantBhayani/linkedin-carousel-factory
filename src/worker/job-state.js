export const MAX_STAGE_ATTEMPTS = 3;
export const STALE_LOCK_MS = 30 * 60 * 1000;

const renderEligible = new Set(["carousel_created", "render_retry"]);
const draftEligible = new Set(["render_created", "draft_retry"]);
const terminalStatuses = new Set(["render_failed", "draft_failed", "draft_created"]);

export function stageFor(job, now = new Date()) {
  if (!job || typeof job !== "object") return null;

  const status = job.status;
  const attempts = status === "render_retry" || status === "rendering"
    ? job.renderAttempts
    : job.draftAttempts;

  if (terminalStatuses.has(status)) return null;
  if (attempts >= MAX_STAGE_ATTEMPTS) return null;

  if (renderEligible.has(status)) return "render";
  if (draftEligible.has(status)) return "draft";

  if (status === "rendering" || status === "drafting") {
    const lockedAt = job.lockedAt;
    if (!lockedAt) return null;
    const lockTime = new Date(lockedAt);
    if (isNaN(lockTime.getTime())) return null;
    const age = now.getTime() - lockTime.getTime();
    return age >= STALE_LOCK_MS ? (status === "rendering" ? "render" : "draft") : null;
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
