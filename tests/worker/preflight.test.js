import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSheet, formatReport, checkNextPayload } from "../../src/worker/preflight.js";
import { SHEET_COLUMNS } from "../../src/adapters/sheets-queue.js";

const NOW = new Date("2026-10-13T10:00:00.000Z");
const SECRET_POST = "This exact post text must never be printed by preflight.";

function rowFor(values, header = SHEET_COLUMNS) {
  return header.map((name) => values[name] ?? "");
}

test("reports missing worker headers and stops there", () => {
  const header = SHEET_COLUMNS.filter((name) => name !== "updated_at" && name !== "error");
  const report = analyzeSheet([header], NOW);
  assert.deepEqual(report.missingHeaders, ["error", "updated_at"]);
  assert.equal(report.ok, false);
});

test("flags duplicates, unsafe ids, padded ids and unknown statuses without exposing post text", () => {
  const rows = [
    [...SHEET_COLUMNS],
    rowFor({ job_id: " live-001", post_text: SECRET_POST, status: "draft_created" }),
    rowFor({ job_id: "test-003", post_text: `${SECRET_POST} `, status: "queued" }),
    rowFor({ job_id: "bad/id", post_text: "other", status: "carousel_created", carousel_file: "https://drive.google.com/file/d/abcdefghijk/view" }),
    rowFor({ job_id: "odd-1", post_text: "third", status: "Draft Created" })
  ];
  const report = analyzeSheet(rows, NOW);

  assert.equal(report.ok, false);
  assert.deepEqual(report.duplicateGroups, [["Sheet1!2", "Sheet1!3"]]);
  const issues = Object.fromEntries(report.rows.map((row) => [row.rowId, row.issues]));
  assert.ok(issues["Sheet1!2"].some((issue) => issue.includes("surrounding whitespace")));
  assert.ok(issues["Sheet1!4"].some((issue) => issue.includes("unsafe job_id")));
  assert.ok(issues["Sheet1!5"].some((issue) => issue.includes("unknown status")));
  assert.ok(!formatReport(report).includes("exact post text"));
});

test("names the row the worker would pick next and its stage", () => {
  const rows = [
    [...SHEET_COLUMNS],
    rowFor({ job_id: "done-1", post_text: "a", status: "draft_created" }),
    rowFor({ job_id: "new-1", post_text: "b", status: "carousel_created", carousel_file: "https://drive.google.com/file/d/abcdefghijk/view" })
  ];
  const report = analyzeSheet(rows, NOW);
  assert.equal(report.ok, true);
  assert.deepEqual(report.next, { rowId: "Sheet1!3", jobId: "new-1", stage: "render", carouselFile: "https://drive.google.com/file/d/abcdefghijk/view" });
  assert.match(formatReport(report), /next: Sheet1!3 new-1 render/);
});

test("a carousel_created row without a Drive reference is reported", () => {
  const rows = [
    [...SHEET_COLUMNS],
    rowFor({ job_id: "new-1", post_text: "b", status: "carousel_created", carousel_file: "Open carousel JSON" })
  ];
  const report = analyzeSheet(rows, NOW);
  assert.ok(report.rows[0].issues.some((issue) => issue.includes("carousel_file is not a Drive file reference")));
});

test("checkNextPayload reads only Drive metadata and compares the filename", async () => {
  const calls = [];
  const drive = {
    files: {
      async get(params) {
        calls.push(params);
        return { data: { id: "abcdefghijk", name: " new-1-carousel-v1.json", mimeType: "application/json" } };
      }
    }
  };
  const result = await checkNextPayload(drive, { jobId: "new-1", stage: "render", carouselFile: "https://drive.google.com/file/d/abcdefghijk/view" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].alt, undefined, "file contents are not downloaded");
  assert.equal(result.ok, true);
  assert.match(result.message, /new-1-carousel-v1\.json/);
});

test("checkNextPayload reports a file the service account cannot see", async () => {
  const drive = { files: { async get() { throw Object.assign(new Error("File not found: abcdefghijk."), { status: 404 }); } } };
  const result = await checkNextPayload(drive, { jobId: "new-1", stage: "render", carouselFile: "https://drive.google.com/file/d/abcdefghijk/view" });
  assert.equal(result.ok, false);
  assert.match(result.message, /404/);
});

// Shape of the real Sheet export from 2026-10-13: archived rows, and two finished rows
// (test-003 draft_failed, live-001 draft_created) with identical post text.
test("archived rows and duplicates among finished rows do not fail preflight", () => {
  const rows = [
    [...SHEET_COLUMNS],
    rowFor({ job_id: "test-001", post_text: "Test post", status: "archived" }),
    rowFor({ job_id: "test-003", post_text: "Same finished post", status: "draft_failed" }),
    rowFor({ job_id: "live-001", post_text: "Same finished post", status: "draft_created" })
  ];
  const report = analyzeSheet(rows, NOW);
  assert.equal(report.ok, true);
  assert.deepEqual(report.rows[0].issues, []);
  assert.deepEqual(report.duplicateGroups, [["Sheet1!3", "Sheet1!4"]]);
  assert.match(formatReport(report), /duplicate post_text: Sheet1!3, Sheet1!4 \(all finished; informational\)/);
});

test("a duplicate that involves a row still in progress fails preflight", () => {
  const rows = [
    [...SHEET_COLUMNS],
    rowFor({ job_id: "live-001", post_text: "Same post", status: "draft_created" }),
    rowFor({ job_id: "copy-001", post_text: "Same post", status: "queued" })
  ];
  const report = analyzeSheet(rows, NOW);
  assert.equal(report.ok, false);
  assert.match(formatReport(report), /duplicate post_text: Sheet1!2, Sheet1!3 \(the worker will stop these rows\)/);
});
