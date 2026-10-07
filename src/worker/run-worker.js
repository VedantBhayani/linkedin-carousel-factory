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
    const safeError = error instanceof WorkerError ? error : new WorkerError("external", "unknown", error.message, error);
    await handleFailure(activeJob, activeStage, safeError, ports);
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
    throw new WorkerError("data_integrity", "invalid_render_manifest", "Stored render manifest is missing or invalid");
  }

  const existingDraft = await DraftService.findDraft({ runKey: manifest.runKey, storedDraftId: draftJob.bufferDraftId });
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