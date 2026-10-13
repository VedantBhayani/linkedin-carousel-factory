import { assertWorkerPorts } from "./ports.js";
import { stageFor, claimJob, failureTransition, MAX_STAGE_ATTEMPTS } from "./job-state.js";
import { WorkerError, toSafeQueueError, toWorkerError, describeThrown, redactForLog } from "./errors.js";
import { createRunKey, createManifestDraft, validateStoredManifest } from "./manifest.js";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

async function runWorker({ ports, clock, createWorkerId }) {
  assertWorkerPorts(ports);
  const { JobQueue, PayloadStore, CarouselRenderer, AssetStore, DraftService } = ports;
  const now = clock.now();
  const workerId = createWorkerId();

  const eligibleJob = await JobQueue.findEligible(now);
  if (!eligibleJob) {
    return { outcome: "idle" };
  }

  const stage = stageFor(eligibleJob, now);
  if (!stage) {
    return { outcome: "idle" };
  }

  let activeJob = eligibleJob;
  let activeStage = stage;
  try {
    const claimed = claimJob(eligibleJob, stage, now, workerId);
    await JobQueue.persistClaim(eligibleJob.rowId, {
      status: claimed.status,
      renderAttempts: claimed.renderAttempts,
      draftAttempts: claimed.draftAttempts,
      lockedAt: claimed.lockedAt,
      workerId: claimed.workerId,
      error: ""
    });
    activeJob = claimed;

    if (stage === "render") {
      const renderOut = await handleRenderStage(claimed, now, workerId, ports);
      const forDraft = {
        ...claimed,
        status: "render_created",
        renderManifest: renderOut.manifest.locator,
        workerId: "",
        lockedAt: ""
      };
      activeJob = forDraft;
      activeStage = "draft";
      const draftOut = await handleDraftStage(forDraft, now, workerId, ports, (j) => { activeJob = j; });
      return { ...draftOut, manifest: renderOut.manifest };
    }
    const draftOut = await handleDraftStage(claimed, now, workerId, ports, (j) => { activeJob = j; });
    return draftOut;
  } catch (error) {
    const safeError = toWorkerError(error);
    const { status, message } = describeThrown(error);
    // Status and message come before the shape: the shape is truncated to 500 characters
    // and Cloudinary puts request_options ahead of the actual error.
    console.error(
      `[worker] job=${activeJob?.jobId ?? ""} stage=${activeStage} outcome=failed type=${safeError.type} code=${safeError.code} ` +
      `status=${status ?? ""} thrown=${error?.constructor?.name ?? typeof error} message=${redactForLog(message)} ` +
      `shape=${redactForLog(safeStringify(error))}`
    );
    await handleFailure(activeJob, activeStage, safeError, ports);
    return { outcome: "failed", error: safeError.code };
  }
}

function safeStringify(value) {
  try {
    const seen = new Set();
    return JSON.stringify(value, (key, val) => {
      if (key === "private_key") return "[key]";
      if (val && typeof val === "object") {
        if (seen.has(val)) return "[circular]";
        seen.add(val);
      }
      return val;
    });
  } catch {
    return String(value);
  }
}

async function handleRenderStage(job, now, workerId, ports) {
  const { JobQueue, PayloadStore, CarouselRenderer, AssetStore } = ports;

  // The canonical job id is the trimmed Sheet value. It becomes part of Cloudinary
  // public IDs and the run key, so only path-safe characters are accepted.
  const jobId = String(job.jobId ?? "").trim();
  if (!SAFE_JOB_ID.test(jobId)) {
    throw new WorkerError("validation", "invalid_job_id", "Job id must contain only letters, digits, hyphens, or underscores");
  }

  assertUniquePostText(job);

  const downloadResult = await PayloadStore.download(job.carouselFile);
  const expectedFileName = `${jobId}-carousel-v1.json`;
  // Drive and the scheduled task have both produced whitespace-padded names and ids
  // for the same job (live-001), so surrounding whitespace is not significant.
  if (String(downloadResult.fileName ?? "").trim() !== expectedFileName) {
    throw new WorkerError("validation", "invalid_filename", `Expected ${expectedFileName}, got ${downloadResult.fileName}`);
  }

  let carousel;
  try {
    carousel = JSON.parse(new TextDecoder().decode(downloadResult.bytes));
  } catch (e) {
    throw new WorkerError("validation", "invalid_json", "Carousel JSON parse failed");
  }

  if (typeof carousel?.jobId !== "string" || carousel.jobId.trim() !== jobId) {
    throw new WorkerError("validation", "jobid_mismatch", `JSON jobId ${carousel?.jobId} != queue jobId ${jobId}`);
  }

  const runKey = createRunKey(jobId, downloadResult.bytes);
  const existingManifest = await AssetStore.findManifest(runKey);
  if (existingManifest) {
    await JobQueue.persistState(job.rowId, {
      status: "render_created",
      renderManifest: existingManifest.locator,
      workerId: "",
      lockedAt: "",
      error: ""
    });
    return { outcome: "render_created", manifest: existingManifest };
  }

  const tempDir = join(PROJECT_ROOT, "tmp", `worker-${workerId}`);
  const inputPath = join(tempDir, "input", expectedFileName);
  const distDir = join(tempDir, "output");
  
  mkdirSync(join(tempDir, "input"), { recursive: true });
  mkdirSync(distDir, { recursive: true });
  writeFileSync(inputPath, downloadResult.bytes);

  try {
    const renderResult = await CarouselRenderer.render({ inputPath, distDir });
    
    const manifestDraft = await createManifestDraft({
      jobId,
      payloadBytes: downloadResult.bytes,
      outputs: {
        pdf: { name: "carousel.pdf", bytes: readFileSync(renderResult.pdf) },
        cover: { name: "cover.jpg", bytes: readFileSync(renderResult.cover) },
        slides: renderResult.slides.map((slidePath) => ({
          name: slidePath.split("/").pop().split("\\").pop(),
          bytes: readFileSync(slidePath)
        }))
      },
      now
    });

    const { manifest } = await AssetStore.store(renderResult, manifestDraft);
    validateStoredManifest(manifest);

    await JobQueue.persistState(job.rowId, {
      status: "render_created",
      renderManifest: manifest.locator,
      workerId: "",
      lockedAt: "",
      error: ""
    });

    return { outcome: "render_created", manifest };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function handleDraftStage(job, now, workerId, ports, onClaimed) {
  const { JobQueue, AssetStore, DraftService } = ports;

  let draftJob = job;
  if (job.status !== "drafting") {
    const draftClaimed = claimJob(job, "draft", now, workerId);
    await JobQueue.persistClaim(job.rowId, {
      status: draftClaimed.status,
      renderAttempts: draftClaimed.renderAttempts,
      draftAttempts: draftClaimed.draftAttempts,
      lockedAt: draftClaimed.lockedAt,
      workerId: draftClaimed.workerId,
      error: ""
    });
    draftJob = draftClaimed;
    if (onClaimed) onClaimed(draftClaimed);
  }

  let manifest = null;
  try {
    manifest = await AssetStore.loadManifest(draftJob.renderManifest);
  } catch (error) {
    throw error;
  }
  try {
    validateStoredManifest(manifest);
  } catch (error) {
    throw new WorkerError(
      "data_integrity",
      "invalid_render_manifest",
      `Stored render manifest is missing or invalid: ${error.message}`,
      error
    );
  }

  // Without a stored draft id the draft can only be found by caption, which is ambiguous
  // when another row has the same post text.
  if (!draftJob.bufferDraftId) assertUniquePostText(draftJob);

  const existingDraft = await DraftService.findDraft({
    runKey: manifest.runKey,
    storedDraftId: draftJob.bufferDraftId,
    caption: draftJob.postText
  });
  if (existingDraft) {
    await JobQueue.persistState(draftJob.rowId, {
      status: "draft_created",
      bufferDraftId: existingDraft.id,
      bufferDraftUrl: existingDraft.url,
      workerId: "",
      lockedAt: "",
      error: ""
    });
    return { outcome: "draft_created", draft: existingDraft, manifest };
  }

  try {
    const pdfFile = manifest.files.pdf;
    const coverFile = manifest.files.cover;
    const draft = await DraftService.createDraft({
      runKey: manifest.runKey,
      caption: draftJob.postText,
      pdfUrl: pdfFile.url,
      coverUrl: coverFile.url
    });

    await JobQueue.persistState(draftJob.rowId, {
      status: "draft_created",
      bufferDraftId: draft.id,
      bufferDraftUrl: draft.url,
      workerId: "",
      lockedAt: "",
      error: ""
    });

    return { outcome: "draft_created", draft, manifest };
  } catch (error) {
    if (error instanceof WorkerError) {
      throw error;
    }
    throw new WorkerError("external", "buffer_create_failed", `Failed to create Buffer draft: ${describeThrown(error).message}`, error);
  }
}

function assertUniquePostText(job) {
  const duplicates = job.duplicatePostTextRowIds ?? [];
  if (duplicates.length > 0) {
    throw new WorkerError(
      "validation",
      "duplicate_post_text",
      `post_text is identical to ${duplicates.join(", ")}; a human must make it unique or remove the duplicate row`
    );
  }
}

async function handleFailure(job, stage, error, ports) {
  const { JobQueue } = ports;
  const failed = failureTransition(job, stage, error);
  const safeError = toSafeQueueError(error);
  await JobQueue.persistState(job.rowId, {
    status: failed.status,
    error: safeError.message,
    workerId: "",
    lockedAt: "",
    renderAttempts: failed.renderAttempts,
    draftAttempts: failed.draftAttempts
  });
}

export { runWorker };
