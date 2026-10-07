export function createFakeQueue(initialJobs = []) {
  const jobs = new Map(initialJobs.map((j) => [j.rowId, { ...j }]));
  const calls = { findEligible: 0, persistClaim: 0, persistState: 0 };

  return {
    calls,
    resetCalls() {
      Object.keys(calls).forEach((k) => (calls[k] = 0));
    },
    async findEligible(now = new Date()) {
      calls.findEligible++;
      for (const job of jobs.values()) {
        if (job.status === "carousel_created" || job.status === "render_retry") {
          return { ...job };
        }
        if (job.status === "rendering" || job.status === "drafting") {
          const lockTime = new Date(job.lockedAt).getTime();
          if (!isNaN(lockTime) && now.getTime() - lockTime >= 30 * 60 * 1000) {
            return { ...job };
          }
        }
        if (job.status === "render_created" || job.status === "draft_retry") {
          return { ...job };
        }
      }
      return null;
    },
    async persistClaim(rowId, updates) {
      calls.persistClaim++;
      const job = jobs.get(rowId);
      if (!job) throw new Error(`Job not found: ${rowId}`);
      
      const protectedFields = ["jobId", "postText", "carouselFile", "briefFile"];
      for (const field of protectedFields) {
        if (updates[field] !== undefined && updates[field] !== job[field]) {
          throw new Error(`Attempt to modify protected field: ${field}`);
        }
      }
      
      Object.assign(job, updates);
      return { ...job };
    },
    async persistState(rowId, updates) {
      calls.persistState++;
      const job = jobs.get(rowId);
      if (!job) throw new Error(`Job not found: ${rowId}`);
      Object.assign(job, updates);
      return { ...job };
    },
    getJob(rowId) {
      return jobs.get(rowId);
    },
    getAllJobs() {
      return Array.from(jobs.values());
    }
  };
}

export function createFakePayloadStore(files = new Map()) {
  const calls = { download: 0 };
  return {
    calls,
    async download(carouselFile) {
      calls.download++;
      const match = carouselFile.match(/\/([^/]+-carousel-v1\.json)$/);
      const fileName = match ? match[1] : "unknown.json";
      const entry = files.get(fileName);
      if (!entry) throw new Error(`File not found: ${fileName}`);
      return { fileName, bytes: entry.bytes };
    },
    addFile(fileName, bytes) {
      files.set(fileName, { bytes });
    }
  };
}

export function createFakeRenderer(renderFn) {
  const calls = { render: 0 };
  return {
    calls,
    async render({ inputPath, distDir }) {
      calls.render++;
      return await renderFn({ inputPath, distDir });
    }
  };
}

export function createFakeAssetStore(manifests = new Map(), assets = new Map()) {
  const calls = { findManifest: 0, store: 0, loadManifest: 0 };
  return {
    calls,
    async findManifest(runKey) {
      calls.findManifest++;
      return manifests.get(runKey) || null;
    },
    async store(renderResult, manifestDraft) {
      calls.store++;
      const stored = { ...manifestDraft, locator: `cloudinary://${manifestDraft.runKey}` };
      for (const [key, file] of Object.entries(manifestDraft.files)) {
        if (key !== "slides") {
          file.url = `https://cloudinary.com/${key}/${manifestDraft.runKey}/${file.name}`;
        } else {
          file.forEach((slide, i) => {
            slide.url = `https://cloudinary.com/slides/${manifestDraft.runKey}/${slide.name}`;
          });
        }
      }
      manifests.set(manifestDraft.runKey, stored);
      return { manifest: stored, locator: stored.locator };
    },
    async loadManifest(locator) {
      calls.loadManifest++;
      const runKey = locator.replace("cloudinary://", "");
      return manifests.get(runKey) || null;
    },
    addManifest(runKey, manifest) {
      manifests.set(runKey, manifest);
    }
  };
}

export function createFakeDraftService(drafts = new Map()) {
  const calls = { findDraft: 0, createDraft: 0 };
  return {
    calls,
    async findDraft({ runKey, storedDraftId }) {
      calls.findDraft++;
      if (storedDraftId && drafts.has(storedDraftId)) {
        return drafts.get(storedDraftId);
      }
      for (const draft of drafts.values()) {
        if (draft.runKey === runKey) return draft;
      }
      return null;
    },
    async createDraft({ runKey, caption, pdfUrl }) {
      calls.createDraft++;
      const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const draft = { id, url: `https://buffer.com/draft/${id}`, runKey, caption, pdfUrl };
      drafts.set(id, draft);
      return draft;
    },
    addDraft(draft) {
      drafts.set(draft.id, draft);
    }
  };
}

export function createTestClock(start = new Date("2026-10-07T12:00:00.000Z")) {
  let current = start;
  return {
    now() {
      return new Date(current);
    },
    advance(ms) {
      current = new Date(current.getTime() + ms);
    }
  };
}

export function createWorkerId() {
  return `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}