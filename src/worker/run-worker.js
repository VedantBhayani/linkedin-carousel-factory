import { assertWorkerPorts } from "./ports.js";
import { stageFor, claimJob, failureTransition, MAX_STAGE_ATTEMPTS } from "./job-state.js";
import { WorkerError, toSafeQueueError } from "./errors.js";
import { createRunKey, createManifestDraft, validateStoredManifest } from "./manifest.js";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");

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

    if (stage === "render") {
      return await handleRenderStage(claimed, now, workerId, ports);
    } else {
      return await handleDraftStage(claimed, now, workerId, ports);
    }
  } catch (error) {
    const safeError = error instanceof WorkerError ? error : new WorkerError("external", "unknown", error.message, error);
    await handleFailure(eligibleJob, stage, safeError, ports);
    return { outcome: "failed", error: safeError.code };
  }
}

async function handleRenderStage(job, now, workerId, ports) {
  const { JobQueue, PayloadStore, CarouselRenderer, AssetStore } = ports;

  const downloadResult = await PayloadStore.download(job.carouselFile);
  const expectedFileName = `${job.jobId}-carousel-v1.json`;
  if (downloadResult.fileName !== expectedFileName) {
    throw new WorkerError("validation", "invalid_filename", `Expected ${expectedFileName}, got ${downloadResult.fileName}`);
  }

  let carousel;
  try {
    carousel = JSON.parse(new TextDecoder().decode(downloadResult.bytes));
  } catch (e) {
    throw new WorkerError("validation", "invalid_json", "Carousel JSON parse failed");
  }

  if (carousel.jobId !== job.jobId) {
    throw new WorkerError("validation", "jobid_mismatch", `JSON jobId ${carousel.jobId} != queue jobId ${job.jobId}`);
  }

  const runKey = createRunKey(job.jobId, downloadResult.bytes);
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
      jobId: job.jobId,
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

async function handleDraftStage(job, now, workerId, ports) {
  const { JobQueue, AssetStore, DraftService } = ports;

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
  }

  const manifest = await AssetStore.loadManifest(job.renderManifest);
  validateStoredManifest(manifest);

  const existingDraft = await DraftService.findDraft({ runKey: manifest.runKey, storedDraftId: job.bufferDraftId });
  if (existingDraft) {
    await JobQueue.persistState(job.rowId, {
      status: "draft_created",
      bufferDraftId: existingDraft.id,
      bufferDraftUrl: existingDraft.url,
      workerId: "",
      lockedAt: "",
      error: ""
    });
    return { outcome: "draft_created", draft: existingDraft };
  }

  try {
    const pdfFile = manifest.files.pdf;
    const draft = await DraftService.createDraft({
      runKey: manifest.runKey,
      caption: job.postText,
      pdfUrl: pdfFile.url
    });

    await JobQueue.persistState(job.rowId, {
      status: "draft_created",
      bufferDraftId: draft.id,
      bufferDraftUrl: draft.url,
      workerId: "",
      lockedAt: "",
      error: ""
    });

    return { outcome: "draft_created", draft };
  } catch (error) {
    if (error instanceof WorkerError && error.type === "ambiguous") {
      throw error;
    }
    throw new WorkerError("external", "buffer_create_failed", "Failed to create Buffer draft");
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