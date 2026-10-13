import { isActionable, findDuplicatePostTextRows } from "../../src/worker/job-state.js";

export function createFakeQueue(initialJobs = []) {
  const jobs = new Map(initialJobs.map((j) => [j.rowId, { ...j }]));
  const calls = { findEligible: 0, persistClaim: 0, persistState: 0 };

  // Same eligibility rule as the Sheet adapter, so worker tests cannot pass on rows
  // production would never pick up.
  function findFirstEligible(now) {
    for (const job of jobs.values()) {
      if (isActionable(job, now)) return { ...job };
    }
    return null;
  }

  return {
    calls,
    resetCalls() {
      Object.keys(calls).forEach((k) => (calls[k] = 0));
    },
    async findEligible(now = new Date()) {
      calls.findEligible++;
      const found = findFirstEligible(now);
      return found ? { ...found, duplicatePostTextRowIds: findDuplicatePostTextRows(found, [...jobs.values()]) } : null;
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
      const match = carouselFile.match(/\/([^/]+\.json)$/);
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

import { WorkerError, AmbiguousExternalError } from "../../src/worker/errors.js";

export function createFakeAssetStore(manifests = new Map(), partials = new Map()) {
  const calls = { findManifest: 0, store: 0, loadManifest: 0 };
  return {
    calls,
    async findManifest(runKey) {
      calls.findManifest++;
      return manifests.get(runKey) || null;
    },
    async store(renderResult, manifestDraft) {
      calls.store++;

      // Reconcile each expected file against partial assets left by an
      // interrupted upload: exact digest+size match is reused, a missing
      // file is uploaded, a digest/size mismatch is a terminal conflict.
      // The manifest itself is written only after every file reconciles.
      const partialKey = (name) => `${manifestDraft.runKey}/${name}`;
      const storedFiles = { pdf: null, cover: null, slides: [] };

      const reconcileFile = (file) => {
        const partial = partials.get(partialKey(file.name));
        if (!partial) {
          file.url = `https://cloudinary.com/files/${manifestDraft.runKey}/${file.name}`;
          return file;
        }
        if (partial.sha256 !== file.sha256 || partial.bytes !== file.bytes) {
          throw new WorkerError("asset_conflict", "asset_conflict", `Asset digest mismatch for ${file.name}`);
        }
        return { ...file, url: partial.url };
      };

      storedFiles.pdf = reconcileFile({ ...manifestDraft.files.pdf });
      storedFiles.cover = reconcileFile({ ...manifestDraft.files.cover });
      storedFiles.slides = manifestDraft.files.slides.map((slide) => reconcileFile({ ...slide }));

      const stored = { ...manifestDraft, files: storedFiles, locator: `cloudinary://${manifestDraft.runKey}` };
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
    },
    addPartial(runKey, file) {
      partials.set(`${runKey}/${file.name}`, { ...file });
    }
  };
}

export function createFakeDraftService(drafts = new Map()) {
  const calls = { findDraft: 0, createDraft: 0 };
  const service = {
    calls,
    lastCreate: null,
    ambiguousOnCreate: false,
    createError: null,
    // Mirrors the production Buffer adapter: a stored draft id is authoritative, otherwise
    // drafts are matched on exact caption text, because Buffer stores no run key.
    async findDraft({ storedDraftId, caption }) {
      calls.findDraft++;
      if (storedDraftId) {
        return drafts.get(storedDraftId) ?? null;
      }
      if (!caption) return null;
      const matches = [...drafts.values()].filter((draft) => draft.caption === caption);
      if (matches.length > 1) {
        throw new WorkerError("data_integrity", "multiple_matching_drafts", `${matches.length} Buffer drafts have this caption`);
      }
      return matches[0] ?? null;
    },
    async createDraft({ runKey, caption, pdfUrl, coverUrl }) {
      calls.createDraft++;
      service.lastCreate = { runKey, caption, pdfUrl, coverUrl };
      if (service.ambiguousOnCreate) {
        service.ambiguousOnCreate = false;
        throw new AmbiguousExternalError("buffer_ambiguous", "Buffer create outcome unknown");
      }
      if (service.createError) {
        throw service.createError;
      }
      const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const draft = { id, url: `https://buffer.com/draft/${id}`, runKey, caption, pdfUrl };
      drafts.set(id, draft);
      return draft;
    },
    addDraft(draft) {
      drafts.set(draft.id, draft);
    }
  };
  return service;
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