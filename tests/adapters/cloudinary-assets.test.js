import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCloudinaryAssetStore } from "../../src/adapters/cloudinary-assets.js";
import { WorkerError } from "../../src/worker/errors.js";

function makeCloudinary() {
  const calls = { upload: 0, resource: 0, resourceOptions: [], loadJsonUrls: [] };
  const objects = new Map();
  const api = {
    calls,
    objects,
    uploader: {
      async upload(data, options) {
        calls.upload++;
        if (objects.has(options.public_id)) {
          const error = new Error("public ID already exists");
          error.http_code = 400;
          throw error;
        }
        const bytes = typeof data === "string" && data.startsWith("data:")
          ? Buffer.from(data.split(",")[1], "base64")
          : Buffer.from(data);
        const record = {
          public_id: options.public_id,
          secure_url: `https://res.cloudinary.com/demo/${options.resource_type}/upload/${options.public_id}`,
          bytes: bytes.length,
          etag: "etag123",
          raw: bytes.toString("utf8")
        };
        objects.set(options.public_id, record);
        return record;
      }
    },
    api: {
      async resource(publicId, options) {
        calls.resource++;
        calls.resourceOptions.push({ publicId, options });
        const found = objects.get(publicId);
        if (!found) {
          const error = new Error("not found");
          error.http_code = 404;
          throw error;
        }
        return found;
      }
    }
  };
  api.loadJson = async (secureUrl) => {
    calls.loadJsonUrls.push(secureUrl);
    for (const record of objects.values()) {
      if (record.secure_url === secureUrl) return JSON.parse(record.raw);
    }
    const error = new Error(`unknown url ${secureUrl}`);
    error.status = 404;
    throw error;
  };
  return api;
}

function makeStore(cloudinary) {
  return createCloudinaryAssetStore({
    cloudinary,
    cloudName: "demo",
    loadJson: cloudinary.loadJson
  });
}

function writeRenderOutput(bytesMap = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudinary-test-"));
  const files = {
    pdf: Buffer.from(bytesMap.pdf ?? "pdf-bytes"),
    cover: Buffer.from(bytesMap.cover ?? "cover-bytes"),
    slides: Array.from({ length: 8 }, (_, i) => Buffer.from(bytesMap[`slide${i}`] ?? `slide-${i}-bytes`))
  };
  const pdfPath = path.join(dir, "carousel.pdf");
  const coverPath = path.join(dir, "cover.jpg");
  fs.writeFileSync(pdfPath, files.pdf);
  fs.writeFileSync(coverPath, files.cover);
  const slidePaths = files.slides.map((bytes, i) => {
    const p = path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`);
    fs.writeFileSync(p, bytes);
    return p;
  });
  return { renderResult: { pdf: pdfPath, cover: coverPath, slides: slidePaths }, files, dir };
}

function manifestDraft(runKey, files) {
  const entry = (name, bytes) => ({ name, sha256: require_sha(bytes), bytes: bytes.length, url: "" });
  return {
    schemaVersion: 1,
    jobId: "test-001",
    payloadSha256: "a".repeat(64),
    runKey,
    style: { family: "dark-editorial", version: 1 },
    createdAt: "2026-10-07T12:00:00.000Z",
    files: {
      pdf: entry("carousel.pdf", files.pdf),
      cover: entry("cover.jpg", files.cover),
      slides: files.slides.map((bytes, i) => entry(`slide-${String(i + 1).padStart(2, "0")}.png`, bytes))
    }
  };
}

function require_sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("findManifest returns null when nothing is stored", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  assert.equal(await store.findManifest("test-001:" + "a".repeat(64)), null);
});

test("store uploads all files under run-key paths with overwrite off", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  const runKey = "test-001:" + "a".repeat(64);
  const { renderResult, files, dir } = writeRenderOutput();

  const { manifest, locator } = await store.store(renderResult, manifestDraft(runKey, files));

  assert.equal(cloudinary.calls.upload, 11);
  const prefix = `carousel/test-001/${"a".repeat(64)}`;
  assert.ok(cloudinary.objects.has(`${prefix}/carousel.pdf`));
  assert.ok(cloudinary.objects.has(`${prefix}/carousel-manifest.json`));
  assert.ok(cloudinary.objects.has(`${prefix}/cover`));
  assert.ok(cloudinary.objects.has(`${prefix}/slide-01`));
  for (const [publicId] of cloudinary.objects) {
    assert.ok(publicId.startsWith(`${prefix}/`));
  }
  assert.ok(locator.startsWith("cloudinary://"));
  assert.ok(manifest.files.pdf.url.startsWith("https://"));
  assert.equal(manifest.files.slides.length, 8);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("store reuses byte-identical remote assets without re-uploading", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  const runKey = "test-001:" + "a".repeat(64);
  const first = writeRenderOutput();
  const firstResult = await store.store(first.renderResult, manifestDraft(runKey, first.files));
  const objectsAfterFirst = cloudinary.objects.size;
  fs.rmSync(first.dir, { recursive: true, force: true });

  const second = writeRenderOutput();
  const secondResult = await store.store(second.renderResult, manifestDraft(runKey, second.files));

  assert.equal(cloudinary.objects.size, objectsAfterFirst);
  assert.equal(secondResult.manifest.files.pdf.url, firstResult.manifest.files.pdf.url);
  assert.deepEqual(
    secondResult.manifest.files.slides.map((s) => s.url),
    firstResult.manifest.files.slides.map((s) => s.url)
  );
  const rawLookups = cloudinary.calls.resourceOptions.filter(({ publicId }) =>
    publicId.endsWith("/carousel.pdf") || publicId.endsWith("/carousel-manifest.json"));
  const imageLookups = cloudinary.calls.resourceOptions.filter(({ publicId }) =>
    publicId.endsWith("/cover") || /\/slide-\d{2}$/.test(publicId));
  assert.ok(rawLookups.length >= 2);
  assert.ok(rawLookups.every(({ options }) => options.resource_type === "raw" && options.type === "upload"));
  assert.equal(imageLookups.length, 9);
  assert.ok(imageLookups.every(({ options }) => options.resource_type === "image" && options.type === "upload"));
  fs.rmSync(second.dir, { recursive: true, force: true });
});

test("store raises asset_conflict on size mismatch", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  const runKey = "test-001:" + "a".repeat(64);
  const first = writeRenderOutput({ pdf: "original-pdf-content" });
  await store.store(first.renderResult, manifestDraft(runKey, first.files));
  fs.rmSync(first.dir, { recursive: true, force: true });

  const second = writeRenderOutput({ pdf: "different" });
  await assert.rejects(
    store.store(second.renderResult, manifestDraft(runKey, second.files)),
    (error) => {
      assert.ok(error instanceof WorkerError);
      assert.equal(error.type, "asset_conflict");
      return true;
    }
  );
  fs.rmSync(second.dir, { recursive: true, force: true });
});

test("store rejects incomplete manifests without uploading", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  const { renderResult, files, dir } = writeRenderOutput();
  const bad = manifestDraft("test-001:" + "a".repeat(64), files);
  bad.files.slides.pop();

  await assert.rejects(store.store(renderResult, bad), /8 slides/);
  assert.equal(cloudinary.calls.upload, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadManifest reloads a stored manifest by locator", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  const runKey = "test-001:" + "a".repeat(64);
  const { renderResult, files, dir } = writeRenderOutput();

  const stored = await store.store(renderResult, manifestDraft(runKey, files));
  const reloaded = await store.loadManifest(stored.locator);
  assert.equal(reloaded.runKey, runKey);
  assert.equal(reloaded.files.slides.length, 8);
  const prefix = `carousel/test-001/${"a".repeat(64)}`;
  assert.equal(
    cloudinary.calls.loadJsonUrls.at(-1),
    `https://res.cloudinary.com/demo/raw/upload/${prefix}/carousel-manifest.json`
  );
  assert.equal(cloudinary.calls.resource, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadManifest uses the stable public delivery URL across worker processes", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  const runKey = "test-001:" + "a".repeat(64);
  const { renderResult, files, dir } = writeRenderOutput();
  const stored = await store.store(renderResult, manifestDraft(runKey, files));

  cloudinary.api.resource = async () => {
    const error = new Error("Admin API lookup missed the raw asset");
    error.http_code = 404;
    throw error;
  };
  const freshStore = makeStore(cloudinary);

  const reloaded = await freshStore.loadManifest(stored.locator);
  assert.equal(reloaded.runKey, runKey);
  assert.equal(reloaded.files.pdf.name, "carousel.pdf");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadManifest tolerates Sheet whitespace around the locator run key", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  const runKey = "test-001:" + "a".repeat(64);
  const { renderResult, files, dir } = writeRenderOutput();
  await store.store(renderResult, manifestDraft(runKey, files));

  const reloaded = await store.loadManifest(` cloudinary:// ${runKey} \n`);
  assert.equal(reloaded.runKey, runKey);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadManifest preserves typed Cloudinary fetch failures", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);
  const runKey = "test-001:" + "a".repeat(64);
  const { renderResult, files, dir } = writeRenderOutput();
  const stored = await store.store(renderResult, manifestDraft(runKey, files));
  const failingStore = createCloudinaryAssetStore({
    cloudinary,
    cloudName: "demo",
    loadJson: async () => {
      throw new Error("upstream 502");
    }
  });

  await assert.rejects(failingStore.loadManifest(stored.locator), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "external");
    assert.equal(error.code, "cloudinary_manifest_fetch");
    assert.match(error.message, /upstream 502/);
    return true;
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadManifest classifies malformed stored JSON as data-integrity failure", async () => {
  const cloudinary = makeCloudinary();
  const runKey = "test-001:" + "a".repeat(64);
  const publicId = `carousel/test-001/${"a".repeat(64)}/carousel-manifest.json`;
  cloudinary.objects.set(publicId, {
    public_id: publicId,
    secure_url: `https://res.cloudinary.com/demo/raw/upload/${publicId}`,
    bytes: 8,
    raw: "not-json"
  });
  const store = makeStore(cloudinary);

  await assert.rejects(store.loadManifest(`cloudinary://${runKey}`), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "data_integrity");
    assert.equal(error.code, "invalid_render_manifest");
    return true;
  });
});

test("loadManifest rejects unknown locators as data-integrity errors", async () => {
  const cloudinary = makeCloudinary();
  const store = makeStore(cloudinary);

  await assert.rejects(store.loadManifest("cloudinary://nope"), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.code, "invalid_render_manifest");
    return true;
  });
});
