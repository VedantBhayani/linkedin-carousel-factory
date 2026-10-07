import assert from "node:assert/strict";
import test from "node:test";
import { extractDriveFileId, createDrivePayloadStore } from "../../src/adapters/drive-payload.js";
import { WorkerError } from "../../src/worker/errors.js";

test("extractDriveFileId parses file URLs", () => {
  assert.equal(
    extractDriveFileId("https://drive.google.com/file/d/abc123XYZ/view?usp=sharing"),
    "abc123XYZ"
  );
});

test("extractDriveFileId parses open URLs", () => {
  assert.equal(
    extractDriveFileId("https://drive.google.com/open?id=abc123XYZ"),
    "abc123XYZ"
  );
});

test("extractDriveFileId passes bare ids through", () => {
  assert.equal(extractDriveFileId("1aBcDeFgHiJkLmNoPqRsT0123"), "1aBcDeFgHiJkLmNoPqRsT0123");
});

test("extractDriveFileId returns null for unparseable references", () => {
  assert.equal(extractDriveFileId(""), null);
  assert.equal(extractDriveFileId("not a url at all!!!"), null);
});

function makeDrive({ name, bytes }) {
  const calls = { meta: 0, media: 0 };
  return {
    calls,
    files: {
      async get({ fileId, fields, alt }) {
        if (alt === "media") {
          calls.media++;
          assert.equal(fileId, "file123");
          return { data: new Uint8Array(bytes).buffer };
        }
        calls.meta++;
        assert.equal(fileId, "file123");
        return { data: { id: "file123", name, mimeType: "application/json" } };
      }
    }
  };
}

test("download returns exact file name and raw bytes", async () => {
  const bytes = new TextEncoder().encode('{"jobId":"launch-video-001"}');
  const drive = makeDrive({ name: "launch-video-001-carousel-v1.json", bytes });
  const store = createDrivePayloadStore({ drive });

  const result = await store.download("https://drive.google.com/file/d/file123/view");
  assert.equal(result.fileName, "launch-video-001-carousel-v1.json");
  assert.deepEqual(Buffer.from(result.bytes).toString("utf8"), '{"jobId":"launch-video-001"}');
  assert.equal(drive.calls.meta, 1);
  assert.equal(drive.calls.media, 1);
});

test("download rejects unparseable references as validation errors", async () => {
  const drive = makeDrive({ name: "x.json", bytes: new Uint8Array() });
  const store = createDrivePayloadStore({ drive });

  await assert.rejects(store.download("not a url at all!!!"), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "validation");
    assert.equal(error.code, "invalid_file_reference");
    return true;
  });
  assert.equal(drive.calls.meta, 0);
  assert.equal(drive.calls.media, 0);
});

test("download propagates provider failures without masking", async () => {
  const drive = {
    files: {
      async get() {
        throw new Error("drive timeout");
      }
    }
  };
  const store = createDrivePayloadStore({ drive });

  await assert.rejects(store.download("https://drive.google.com/file/d/file123/view"), /drive timeout/);
});
