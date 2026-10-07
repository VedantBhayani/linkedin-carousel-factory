import { createHash } from "node:crypto";

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createRunKey(jobId, payloadBytes) {
  const hash = sha256Bytes(payloadBytes);
  return `${jobId}:${hash}`;
}

export async function createManifestDraft({ jobId, payloadBytes, outputs, now }) {
  const payloadSha256 = sha256Bytes(payloadBytes);
  const runKey = createRunKey(jobId, payloadBytes);
  
  const slides = outputs.slides || [];
  if (slides.length !== 8) {
    throw new Error(`Manifest must contain exactly 8 slides, got ${slides.length}`);
  }
  
  const files = {
    pdf: await buildFileEntry(outputs.pdf),
    cover: await buildFileEntry(outputs.cover),
    slides: []
  };
  
  for (const slide of slides) {
    files.slides.push(await buildFileEntry(slide));
  }
  
  for (const [key, entry] of Object.entries(files)) {
    if (key !== "slides" && entry.bytes === 0) {
      throw new Error(`File ${entry.name} must be non-empty`);
    }
  }
  for (const slide of files.slides) {
    if (slide.bytes === 0) {
      throw new Error(`Slide ${slide.name} must be non-empty`);
    }
  }
  
  return {
    schemaVersion: 1,
    jobId,
    payloadSha256,
    runKey,
    style: { family: "dark-editorial", version: 1 },
    createdAt: now.toISOString(),
    files
  };
}

async function buildFileEntry(output) {
  const bytes = output.bytes;
  const sha256 = sha256Bytes(bytes);
  return {
    name: output.name,
    sha256,
    bytes: bytes.length,
    url: ""
  };
}

export function validateStoredManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be an object");
  }
  
  const requiredFields = ["schemaVersion", "jobId", "payloadSha256", "runKey", "style", "createdAt", "files"];
  for (const field of requiredFields) {
    if (!(field in manifest)) {
      throw new Error(`Manifest missing required field: ${field}`);
    }
  }
  
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion: ${manifest.schemaVersion}`);
  }
  
  if (!/^[a-f0-9]{64}$/.test(manifest.payloadSha256)) {
    throw new Error("payloadSha256 must be 64 lowercase hex characters");
  }
  
  if (!manifest.runKey.startsWith(`${manifest.jobId}:`) || !/^[a-f0-9]{64}$/.test(manifest.runKey.split(":")[1])) {
    throw new Error("runKey must be jobId:sha256");
  }
  
  if (manifest.style.family !== "dark-editorial" || manifest.style.version !== 1) {
    throw new Error("style must be dark-editorial version 1");
  }
  
  if (!manifest.files || typeof manifest.files !== "object") {
    throw new Error("files must be an object");
  }
  
  const fileFields = ["pdf", "cover", "slides"];
  for (const field of fileFields) {
    if (!(field in manifest.files)) {
      throw new Error(`files missing required field: ${field}`);
    }
  }
  
  const { pdf, cover, slides } = manifest.files;
  
  validateFileEntry(pdf, "pdf");
  validateFileEntry(cover, "cover");
  
  if (!Array.isArray(slides) || slides.length !== 8) {
    throw new Error(`slides must be an array of exactly 8 entries, got ${slides?.length ?? "undefined"}`);
  }
  
  for (let i = 0; i < slides.length; i++) {
    validateFileEntry(slides[i], `slides[${i}]`);
  }
}

function validateFileEntry(entry, context) {
  if (!entry || typeof entry !== "object") {
    throw new Error(`${context} must be an object`);
  }
  
  const required = ["name", "sha256", "bytes", "url"];
  for (const field of required) {
    if (!(field in entry)) {
      throw new Error(`${context} missing required field: ${field}`);
    }
  }
  
  if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error(`${context}.sha256 must be 64 lowercase hex characters`);
  }
  
  if (typeof entry.bytes !== "number" || entry.bytes <= 0) {
    throw new Error(`${context}.bytes must be a positive number`);
  }
  
  if (typeof entry.url !== "string" || entry.url.length === 0) {
    throw new Error(`${context}.url must be a non-empty string`);
  }
}