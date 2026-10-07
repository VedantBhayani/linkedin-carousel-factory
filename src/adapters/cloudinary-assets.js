import { readFileSync } from "node:fs";
import { v2 as cloudinarySdk } from "cloudinary";
import { WorkerError } from "../worker/errors.js";
import { validateStoredManifest } from "../worker/manifest.js";

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".json": "application/json"
};

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

function baseNameOf(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

function splitRunKey(runKey) {
  const separator = runKey.lastIndexOf(":");
  if (separator === -1) throw new WorkerError("validation", "invalid_run_key", "Run key must be jobId:sha256");
  return { jobId: runKey.slice(0, separator), hash: runKey.slice(separator + 1) };
}

function assetPublicId(runKey, fileName) {
  const { jobId, hash } = splitRunKey(runKey);
  return `carousel/${jobId}/${hash}/${baseNameOf(fileName)}`;
}

function manifestPublicId(runKey) {
  const { jobId, hash } = splitRunKey(runKey);
  return `carousel/${jobId}/${hash}/carousel-manifest`;
}

function resourceTypeOf(fileName) {
  const ext = extensionOf(fileName);
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") return "image";
  return "raw";
}

async function defaultLoadJson(secureUrl) {
  const response = await fetch(secureUrl);
  if (!response.ok) throw new Error(`Manifest fetch failed: ${response.status}`);
  return response.json();
}

export function createCloudinaryAssetStore({ cloudinary, cloudName, apiKey, apiSecret, loadJson = defaultLoadJson } = {}) {
  const client = cloudinary ?? (() => {
    if (!cloudName || !apiKey || !apiSecret) {
      throw new WorkerError("configuration", "missing_cloudinary_credentials", "Cloudinary cloud name, key, and secret are required");
    }
    cloudinarySdk.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    return cloudinarySdk;
  })();

  async function uploadOrReuse(publicId, resourceType, bytes, displayName) {
    const dataUri = `data:${MIME_TYPES[extensionOf(displayName)] ?? "application/octet-stream"};base64,${bytes.toString("base64")}`;
    try {
      const uploaded = await client.uploader.upload(dataUri, {
        public_id: publicId,
        resource_type: resourceType,
        overwrite: false,
        unique_filename: false
      });
      return uploaded;
    } catch (error) {
      if (error?.http_code !== 400) throw error;
      const existing = await client.api.resource(publicId);
      if (existing.bytes === bytes.length) return existing;
      throw new WorkerError("asset_conflict", "asset_conflict", `Asset digest mismatch for ${displayName}`);
    }
  }

  async function findManifest(runKey) {
    let record;
    try {
      record = await client.api.resource(manifestPublicId(runKey));
    } catch (error) {
      const code = error?.error?.http_code ?? error?.http_code ?? error?.statusCode ?? error?.status;
      if (code === 404) return null;
      const message = error?.error?.message ?? error?.message ?? String(error);
      throw new WorkerError("external", "cloudinary_error", `Cloudinary findManifest failed: ${message}`, error);
    }
    const manifest = await loadJson(record.secure_url);
    validateStoredManifest(manifest);
    return { ...manifest, locator: `cloudinary://${runKey}` };
  }

  return {
    findManifest,
    async store(renderResult, manifestDraft) {
      const slides = manifestDraft?.files?.slides;
      if (!manifestDraft?.files?.pdf || !manifestDraft?.files?.cover || !Array.isArray(slides) || slides.length !== 8) {
        throw new Error("Manifest draft must reference a PDF, a cover, and exactly 8 slides");
      }

      const storedFiles = { pdf: null, cover: null, slides: [] };
      const localEntries = [manifestDraft.files.pdf, manifestDraft.files.cover, ...manifestDraft.files.slides];
      const localPaths = [renderResult.pdf, renderResult.cover, ...renderResult.slides];
      for (let i = 0; i < localEntries.length; i += 1) {
        const entry = localEntries[i];
        const bytes = readFileSync(localPaths[i]);
        const publicId = assetPublicId(manifestDraft.runKey, entry.name);
        const uploaded = await uploadOrReuse(publicId, resourceTypeOf(entry.name), bytes, entry.name);
        const stored = { ...entry, url: uploaded.secure_url };
        if (i === 0) storedFiles.pdf = stored;
        else if (i === 1) storedFiles.cover = stored;
        else storedFiles.slides.push(stored);
      }

      const manifest = { ...manifestDraft, files: storedFiles };
      validateStoredManifest(manifest);

      const manifestBytes = Buffer.from(JSON.stringify(manifest));
      const manifestRecord = await uploadOrReuse(
        manifestPublicId(manifest.runKey),
        "raw",
        manifestBytes,
        "carousel-manifest.json"
      );
      void manifestRecord;

      const locator = `cloudinary://${manifest.runKey}`;
      return { manifest: { ...manifest, locator }, locator };
    },
    async loadManifest(locator) {
      const runKey = String(locator).replace(/^cloudinary:\/\//, "");
      try {
        const manifest = await findManifest(runKey);
        if (!manifest) throw new Error("missing");
        return manifest;
      } catch (error) {
        if (error instanceof WorkerError && error.code === "invalid_render_manifest") throw error;
        throw new WorkerError("data_integrity", "invalid_render_manifest", "Stored render manifest is missing or invalid");
      }
    }
  };
}
