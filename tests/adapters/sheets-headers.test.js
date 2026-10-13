import assert from "node:assert/strict";
import test from "node:test";
import { createSheetJobQueue, SHEET_COLUMNS } from "../../src/adapters/sheets-queue.js";
import { WorkerError } from "../../src/worker/errors.js";

const NOW = new Date("2026-10-13T09:30:00.000Z");

function makeSheets(header, rows = []) {
  const calls = { get: 0, batchUpdate: 0, ranges: [] };
  const written = [];
  return {
    calls,
    written,
    spreadsheets: {
      values: {
        async get({ range }) {
          calls.get++;
          calls.ranges.push(range);
          return { data: { values: [header, ...rows] } };
        },
        async batchUpdate({ requestBody }) {
          calls.batchUpdate++;
          written.push(...requestBody.data);
          return { data: {} };
        }
      }
    }
  };
}

function makeQueue(sheets) {
  return createSheetJobQueue({ sheets, spreadsheetId: "sheet-id", sheetName: "Sheet1", clock: { now: () => NOW } });
}

function cells(sheets) {
  return Object.fromEntries(sheets.written.map((entry) => [entry.range, entry.values[0][0]]));
}

function rowFor(header, values) {
  return header.map((name) => values[name.trim()] ?? "");
}

const ELIGIBLE = { job_id: "live-001", post_text: "post", status: "carousel_created", carousel_file: "https://drive.google.com/file/d/abcdefghijk/view" };

test("writes land in the column named by the header, not the default position", async () => {
  const header = [...SHEET_COLUMNS].reverse();
  const sheets = makeSheets(header, [rowFor(header, ELIGIBLE)]);
  const queue = makeQueue(sheets);

  await queue.findEligible(NOW);
  await queue.persistState("Sheet1!2", { status: "render_created", bufferDraftId: "d1" });

  const written = cells(sheets);
  // Reversed 14 columns: status is index 11 (L), buffer_draft_id index 3 (D), updated_at index 0 (A).
  assert.equal(written["Sheet1!L2"], "render_created");
  assert.equal(written["Sheet1!D2"], "d1");
  assert.equal(written["Sheet1!A2"], NOW.toISOString());
  assert.equal(Object.keys(written).length, 3);
});

test("an extra column inserted before the worker columns does not shift writes", async () => {
  const header = ["notes", ...SHEET_COLUMNS];
  const sheets = makeSheets(header, [rowFor(header, ELIGIBLE)]);
  const queue = makeQueue(sheets);

  await queue.findEligible(NOW);
  await queue.persistState("Sheet1!2", { status: "rendering" });

  const written = cells(sheets);
  assert.equal(written["Sheet1!D2"], "rendering", "status moved from C to D");
  assert.ok(!("Sheet1!C2" in written), "the old status position must not be written");
});

test("header names are matched after trimming", async () => {
  const header = SHEET_COLUMNS.map((name) => ` ${name} `);
  const sheets = makeSheets(header, [rowFor(header, ELIGIBLE)]);
  const queue = makeQueue(sheets);

  await queue.persistState("Sheet1!2", { error: "x" });

  assert.equal(cells(sheets)["Sheet1!M2"], "x");
});

test("every write stamps updated_at", async () => {
  const sheets = makeSheets([...SHEET_COLUMNS], [rowFor(SHEET_COLUMNS, ELIGIBLE)]);
  const queue = makeQueue(sheets);

  await queue.persistClaim("Sheet1!2", { status: "rendering", workerId: "w1" });

  assert.equal(cells(sheets)["Sheet1!N2"], NOW.toISOString());
});

test("a missing required header fails loudly before any job is returned or written", async () => {
  const header = SHEET_COLUMNS.filter((name) => name !== "buffer_draft_id");
  const sheets = makeSheets(header, [rowFor(header, ELIGIBLE)]);
  const queue = makeQueue(sheets);

  await assert.rejects(queue.findEligible(NOW), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "configuration");
    assert.equal(error.code, "missing_sheet_header");
    assert.match(error.message, /buffer_draft_id/);
    return true;
  });
  await assert.rejects(queue.persistState("Sheet1!2", { status: "x" }), /buffer_draft_id/);
  assert.equal(sheets.calls.batchUpdate, 0);
});

test("brief_file is not required by the worker", async () => {
  const header = SHEET_COLUMNS.filter((name) => name !== "brief_file");
  const sheets = makeSheets(header, [rowFor(header, ELIGIBLE)]);
  const queue = makeQueue(sheets);

  const job = await queue.findEligible(NOW);
  assert.equal(job.jobId, "live-001");
});

test("persistState for a row reads the header when no scan happened in this run", async () => {
  const header = ["extra", ...SHEET_COLUMNS];
  const sheets = makeSheets(header);
  const queue = makeQueue(sheets);

  await queue.persistState("Sheet1!4", { status: "draft_retry" });

  assert.equal(cells(sheets)["Sheet1!D4"], "draft_retry");
  assert.equal(sheets.calls.ranges[0], "Sheet1!1:1");
});
