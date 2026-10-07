import assert from "node:assert/strict";
import test from "node:test";
import { sha256Bytes, createRunKey, createManifestDraft, validateStoredManifest } from "../../src/worker/manifest.js";

test("sha256Bytes produces 64 lowercase hex chars", () => {
  const hash = sha256Bytes(new TextEncoder().encode("hello"));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("sha256Bytes is deterministic", () => {
  const bytes = new TextEncoder().encode("test");
  assert.equal(sha256Bytes(bytes), sha256Bytes(bytes));
});

test("createRunKey combines jobId and payload hash", () => {
  const payload = new TextEncoder().encode("test payload");
  const runKey = createRunKey("job-1", payload);
  assert.match(runKey, /^job-1:[a-f0-9]{64}$/);
});

test("createRunKey is stable for same input", () => {
  const payload = new TextEncoder().encode("stable");
  assert.equal(createRunKey("job-1", payload), createRunKey("job-1", payload));
});

test("createManifestDraft creates valid structure with 8 slides", async () => {
  const payloadBytes = new TextEncoder().encode("carousel payload");
  const outputs = {
    pdf: { name: "carousel.pdf", bytes: new TextEncoder().encode("pdf content") },
    cover: { name: "cover.jpg", bytes: new TextEncoder().encode("cover content") },
    slides: Array.from({ length: 8 }, (_, i) => ({
      name: `slide-${String(i + 1).padStart(2, "0")}.png`,
      bytes: new TextEncoder().encode(`slide ${i + 1}`)
    }))
  };
  const now = new Date("2026-10-07T12:00:00.000Z");
  
  const draft = await createManifestDraft({
    jobId: "launch-video-001",
    payloadBytes,
    outputs,
    now
  });

  assert.equal(draft.schemaVersion, 1);
  assert.equal(draft.jobId, "launch-video-001");
  assert.match(draft.payloadSha256, /^[a-f0-9]{64}$/);
  assert.match(draft.runKey, /^launch-video-001:[a-f0-9]{64}$/);
  assert.equal(draft.style.family, "dark-editorial");
  assert.equal(draft.style.version, 1);
  assert.equal(draft.createdAt, now.toISOString());
  assert.equal(draft.files.slides.length, 8);
  
  for (const slide of draft.files.slides) {
    assert.match(slide.sha256, /^[a-f0-9]{64}$/);
    assert.ok(slide.bytes > 0);
    assert.ok(slide.name.startsWith("slide-"));
  }
  
  assert.match(draft.files.pdf.sha256, /^[a-f0-9]{64}$/);
  assert.ok(draft.files.pdf.bytes > 0);
  assert.match(draft.files.cover.sha256, /^[a-f0-9]{64}$/);
  assert.ok(draft.files.cover.bytes > 0);
});

test("createManifestDraft rejects wrong slide count", async () => {
  const payloadBytes = new TextEncoder().encode("test");
  const outputs = {
    pdf: { name: "carousel.pdf", bytes: new TextEncoder().encode("pdf") },
    cover: { name: "cover.jpg", bytes: new TextEncoder().encode("cover") },
    slides: Array.from({ length: 7 }, (_, i) => ({
      name: `slide-${String(i + 1).padStart(2, "0")}.png`,
      bytes: new TextEncoder().encode(`slide ${i + 1}`)
    }))
  };
  
  await assert.rejects(
    createManifestDraft({ jobId: "job-1", payloadBytes, outputs, now: new Date() }),
    /exactly 8 slides/
  );
});

test("createManifestDraft rejects empty files", async () => {
  const payloadBytes = new TextEncoder().encode("test");
  const outputs = {
    pdf: { name: "carousel.pdf", bytes: new TextEncoder().encode("") },
    cover: { name: "cover.jpg", bytes: new TextEncoder().encode("cover") },
    slides: Array.from({ length: 8 }, (_, i) => ({
      name: `slide-${String(i + 1).padStart(2, "0")}.png`,
      bytes: new TextEncoder().encode(`slide ${i + 1}`)
    }))
  };
  
  await assert.rejects(
    createManifestDraft({ jobId: "job-1", payloadBytes, outputs, now: new Date() }),
    /non-empty/
  );
});

test("validateStoredManifest accepts complete valid manifest", () => {
  const manifest = {
    schemaVersion: 1,
    jobId: "job-1",
    payloadSha256: "a".repeat(64),
    runKey: "job-1:" + "a".repeat(64),
    style: { family: "dark-editorial", version: 1 },
    createdAt: "2026-10-07T12:00:00.000Z",
    files: {
      pdf: { name: "carousel.pdf", sha256: "b".repeat(64), bytes: 100, url: "https://cloudinary.com/pdf" },
      cover: { name: "cover.jpg", sha256: "c".repeat(64), bytes: 100, url: "https://cloudinary.com/cover" },
      slides: Array.from({ length: 8 }, (_, i) => ({
        name: `slide-${String(i + 1).padStart(2, "0")}.png`,
        sha256: "d".repeat(64),
        bytes: 100,
        url: `https://cloudinary.com/slide${i}`
      }))
    }
  };
  
  assert.doesNotThrow(() => validateStoredManifest(manifest));
});

test("validateStoredManifest rejects missing fields", () => {
  const manifest = { schemaVersion: 1, jobId: "job-1" };
  assert.throws(() => validateStoredManifest(manifest), /missing/);
});

test("validateStoredManifest rejects wrong slide count", () => {
  const manifest = {
    schemaVersion: 1,
    jobId: "job-1",
    payloadSha256: "a".repeat(64),
    runKey: "job-1:" + "a".repeat(64),
    style: { family: "dark-editorial", version: 1 },
    createdAt: "2026-10-07T12:00:00.000Z",
    files: {
      pdf: { name: "carousel.pdf", sha256: "b".repeat(64), bytes: 100, url: "u" },
      cover: { name: "cover.jpg", sha256: "c".repeat(64), bytes: 100, url: "u" },
      slides: Array.from({ length: 7 }, (_, i) => ({ name: `slide-${i}.png`, sha256: "d".repeat(64), bytes: 100, url: "u" }))
    }
  };
  assert.throws(() => validateStoredManifest(manifest), /exactly 8 entries/);
});

test("validateStoredManifest rejects non-64-char hashes", () => {
  const manifest = {
    schemaVersion: 1,
    jobId: "job-1",
    payloadSha256: "a".repeat(64),
    runKey: "job-1:" + "a".repeat(64),
    style: { family: "dark-editorial", version: 1 },
    createdAt: "2026-10-07T12:00:00.000Z",
    files: {
      pdf: { name: "carousel.pdf", sha256: "short", bytes: 100, url: "u" },
      cover: { name: "cover.jpg", sha256: "c".repeat(64), bytes: 100, url: "u" },
      slides: Array.from({ length: 8 }, (_, i) => ({ name: `slide-${i}.png`, sha256: "d".repeat(64), bytes: 100, url: "u" }))
    }
  };
  assert.throws(() => validateStoredManifest(manifest), /64 lowercase hex/);
});

test("validateStoredManifest rejects empty files", () => {
  const manifest = {
    schemaVersion: 1,
    jobId: "job-1",
    payloadSha256: "a".repeat(64),
    runKey: "job-1:" + "a".repeat(64),
    style: { family: "dark-editorial", version: 1 },
    createdAt: "2026-10-07T12:00:00.000Z",
    files: {
      pdf: { name: "carousel.pdf", sha256: "b".repeat(64), bytes: 0, url: "u" },
      cover: { name: "cover.jpg", sha256: "c".repeat(64), bytes: 100, url: "u" },
      slides: Array.from({ length: 8 }, (_, i) => ({ name: `slide-${i}.png`, sha256: "d".repeat(64), bytes: 100, url: "u" }))
    }
  };
  assert.throws(() => validateStoredManifest(manifest), /positive number/);
});