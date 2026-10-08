import assert from "node:assert/strict";
import test from "node:test";
import { rowToJob, createSheetJobQueue, SHEET_COLUMNS } from "../../src/adapters/sheets-queue.js";

const HEADER = [...SHEET_COLUMNS];
const NOW = new Date("2026-10-07T12:00:00.000Z");

function row(values) {
  return values;
}

function makeSheets(rows) {
  const calls = { get: 0, batchUpdate: 0 };
  const stored = { ranges: [] };
  return {
    calls,
    stored,
    spreadsheets: {
      values: {
        async get() {
          calls.get++;
          return { data: { values: [HEADER, ...rows] } };
        },
        async batchUpdate({ requestBody }) {
          calls.batchUpdate++;
          stored.ranges.push(...requestBody.data);
          return { data: {} };
        }
      }
    }
  };
}

const baseRow = [
  "launch-video-001",
  "full source post text",
  "carousel_created",
  "https://drive.google.com/brief",
  "https://drive.google.com/launch-video-001-carousel-v1.json",
  "0",
  "0",
  "",
  "",
  "",
  "",
  "",
  "",
  "2026-10-07T11:00:00.000Z"
];

test("rowToJob maps every column to canonical fields", () => {
  const job = rowToJob(HEADER, row(baseRow), 2, "Sheet1");
  assert.equal(job.jobId, "launch-video-001");
  assert.equal(job.postText, "full source post text");
  assert.equal(job.status, "carousel_created");
  assert.equal(job.carouselFile, "https://drive.google.com/launch-video-001-carousel-v1.json");
  assert.equal(job.renderAttempts, 0);
  assert.equal(job.draftAttempts, 0);
  assert.equal(job.rowId, "Sheet1!2");
  assert.equal(job.renderManifest, "");
  assert.equal(job.bufferDraftId, "");
  assert.equal(job.error, "");
});

test("rowToJob defaults attempts to zero on empty cells", () => {
  const cells = [...baseRow];
  cells[5] = "";
  cells[6] = "";
  const job = rowToJob(HEADER, row(cells), 2, "Sheet1");
  assert.equal(job.renderAttempts, 0);
  assert.equal(job.draftAttempts, 0);
});

test("rowToJob tolerates surrounding whitespace in header names", () => {
  const header = [...HEADER];
  header[3] = " brief_file ";
  header[7] = " worker_id";
  header[9] = "render_manifest ";
  const cells = [...baseRow];
  cells[7] = "worker-1";
  cells[9] = "cloudinary://launch-video-001:" + "a".repeat(64);

  const job = rowToJob(header, row(cells), 2, "Sheet1");
  assert.equal(job.briefFile, "https://drive.google.com/brief");
  assert.equal(job.workerId, "worker-1");
  assert.equal(job.renderManifest, cells[9]);
});

test("findEligible returns the first eligible row only", async () => {
  const done = [...baseRow];
  done[0] = "done-1";
  done[2] = "draft_created";
  const queued = [...baseRow];
  queued[0] = "job-2";
  const sheets = makeSheets([done, queued]);
  const queue = createSheetJobQueue({ sheets, spreadsheetId: "sheet-id", sheetName: "Sheet1" });

  const job = await queue.findEligible(NOW);
  assert.equal(job.jobId, "job-2");
  assert.equal(job.rowId, "Sheet1!3");
  assert.equal(sheets.calls.get, 1);
});

test("findEligible ignores surrounding whitespace in lifecycle cells", async () => {
  const retry = [...baseRow];
  retry[0] = " live-001 ";
  retry[2] = " render_retry \n";
  retry[5] = " 2 ";
  const sheets = makeSheets([retry]);
  const queue = createSheetJobQueue({ sheets, spreadsheetId: "sheet-id", sheetName: "Sheet1" });

  const job = await queue.findEligible(NOW);
  assert.equal(job.jobId, "live-001");
  assert.equal(job.status, "render_retry");
  assert.equal(job.renderAttempts, 2);
});

test("findEligible returns null when no row is eligible", async () => {
  const done = [...baseRow];
  done[2] = "draft_created";
  const sheets = makeSheets([done]);
  const queue = createSheetJobQueue({ sheets, spreadsheetId: "sheet-id", sheetName: "Sheet1" });

  assert.equal(await queue.findEligible(NOW), null);
});

test("findEligible reclaims a stale rendering lock", async () => {
  const stale = [...baseRow];
  stale[2] = "rendering";
  stale[7] = "dead-worker";
  stale[8] = new Date(NOW.getTime() - 45 * 60 * 1000).toISOString();
  const sheets = makeSheets([stale]);
  const queue = createSheetJobQueue({ sheets, spreadsheetId: "sheet-id", sheetName: "Sheet1" });

  const job = await queue.findEligible(NOW);
  assert.equal(job.jobId, "launch-video-001");
  assert.equal(job.status, "rendering");
});

test("persistClaim writes one batchUpdate with mapped columns", async () => {
  const sheets = makeSheets([baseRow]);
  const queue = createSheetJobQueue({ sheets, spreadsheetId: "sheet-id", sheetName: "Sheet1" });

  await queue.persistClaim("Sheet1!2", {
    status: "rendering",
    renderAttempts: 1,
    draftAttempts: 0,
    lockedAt: NOW.toISOString(),
    workerId: "worker-1",
    error: ""
  });

  assert.equal(sheets.calls.batchUpdate, 1);
  const ranges = Object.fromEntries(sheets.stored.ranges.map((r) => [r.range, r.values[0][0]]));
  assert.equal(ranges["Sheet1!C2"], "rendering");
  assert.equal(ranges["Sheet1!F2"], "1");
  assert.equal(ranges["Sheet1!H2"], "worker-1");
  assert.ok(!("Sheet1!A2" in ranges));
  assert.ok(!("Sheet1!B2" in ranges));
  assert.ok(!("Sheet1!E2" in ranges));
});

test("persistState writes render manifest and draft fields", async () => {
  const sheets = makeSheets([baseRow]);
  const queue = createSheetJobQueue({ sheets, spreadsheetId: "sheet-id", sheetName: "Sheet1" });

  await queue.persistState("Sheet1!2", {
    status: "draft_created",
    bufferDraftId: "d1",
    bufferDraftUrl: "https://buffer.com/draft/d1",
    error: ""
  });

  const ranges = Object.fromEntries(sheets.stored.ranges.map((r) => [r.range, r.values[0][0]]));
  assert.equal(ranges["Sheet1!C2"], "draft_created");
  assert.equal(ranges["Sheet1!K2"], "d1");
  assert.equal(ranges["Sheet1!L2"], "https://buffer.com/draft/d1");
});
