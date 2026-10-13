import { isActionable, findDuplicatePostTextRows } from "../worker/job-state.js";
import { WorkerError } from "../worker/errors.js";

export const SHEET_COLUMNS = [
  "job_id",
  "post_text",
  "status",
  "brief_file",
  "carousel_file",
  "render_attempts",
  "draft_attempts",
  "worker_id",
  "locked_at",
  "render_manifest",
  "buffer_draft_id",
  "buffer_draft_url",
  "error",
  "updated_at"
];

// Columns the worker reads or writes. brief_file belongs to the scheduled task only.
const REQUIRED_COLUMNS = SHEET_COLUMNS.filter((name) => name !== "brief_file");

const CANONICAL_TO_COLUMN = {
  status: "status",
  renderAttempts: "render_attempts",
  draftAttempts: "draft_attempts",
  lockedAt: "locked_at",
  workerId: "worker_id",
  renderManifest: "render_manifest",
  bufferDraftId: "buffer_draft_id",
  bufferDraftUrl: "buffer_draft_url",
  error: "error",
  updatedAt: "updated_at"
};

function parseAttempts(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

export function rowToJob(header, values, rowNumber, sheetName) {
  const normalizedHeader = header.map((name) => String(name).trim());
  const cell = (name) => {
    const index = normalizedHeader.indexOf(name);
    return index === -1 ? "" : (values[index] ?? "");
  };
  const controlCell = (name) => String(cell(name)).trim();
  return {
    jobId: controlCell("job_id"),
    rowId: `${sheetName}!${rowNumber}`,
    postText: cell("post_text"),
    status: controlCell("status"),
    briefFile: controlCell("brief_file"),
    carouselFile: controlCell("carousel_file"),
    renderAttempts: parseAttempts(cell("render_attempts")),
    draftAttempts: parseAttempts(cell("draft_attempts")),
    lockedAt: controlCell("locked_at"),
    workerId: controlCell("worker_id"),
    renderManifest: controlCell("render_manifest"),
    bufferDraftId: controlCell("buffer_draft_id"),
    bufferDraftUrl: controlCell("buffer_draft_url"),
    error: cell("error"),
    updatedAt: controlCell("updated_at")
  };
}

function columnLetter(index) {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function columnIndexes(header) {
  const normalized = header.map((name) => String(name).trim());
  const missing = REQUIRED_COLUMNS.filter((name) => !normalized.includes(name));
  if (missing.length > 0) {
    throw new WorkerError("configuration", "missing_sheet_header", `Sheet header row is missing: ${missing.join(", ")}`);
  }
  return Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, normalized.indexOf(name)]));
}

export function createSheetJobQueue({ sheets, spreadsheetId, sheetName, clock = { now: () => new Date() } }) {
  if (!sheets || !spreadsheetId || !sheetName) {
    throw new Error("sheets client, spreadsheetId, and sheetName are required");
  }

  // Writes are addressed by header name, so inserting or reordering Sheet columns cannot
  // send a value into the wrong cell. The header from this run's scan is reused.
  let indexes = null;

  async function loadIndexes() {
    if (indexes) return indexes;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!1:1` });
    indexes = columnIndexes(response.data.values?.[0] ?? []);
    return indexes;
  }

  async function readAll() {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName
    });
    return response.data.values ?? [];
  }

  async function writeRow(rowId, updates) {
    const match = /^(.+)!(\d+)$/.exec(rowId);
    if (!match) throw new Error(`Invalid rowId: ${rowId}`);
    const [, sheet, rowNumber] = match;
    const columns = await loadIndexes();
    const data = [];
    const stamped = { ...updates, updatedAt: clock.now().toISOString() };
    for (const [canonical, value] of Object.entries(stamped)) {
      const column = CANONICAL_TO_COLUMN[canonical];
      if (!column) continue;
      const index = columns[column];
      data.push({
        range: `${sheet}!${columnLetter(index)}${rowNumber}`,
        values: [[String(value ?? "")]]
      });
    }
    if (data.length === 0) return;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data }
    });
  }

  return {
    async findEligible(now = new Date()) {
      const rows = await readAll();
      if (rows.length === 0) return null;
      const header = rows[0];
      indexes = columnIndexes(header);
      if (rows.length < 2) return null;
      const jobs = rows.slice(1).map((values, i) => rowToJob(header, values, i + 2, sheetName));
      for (const job of jobs) {
        if (!job.jobId) continue;
        if (isActionable(job, now)) {
          return { ...job, duplicatePostTextRowIds: findDuplicatePostTextRows(job, jobs) };
        }
      }
      return null;
    },
    async persistClaim(rowId, updates) {
      await writeRow(rowId, updates);
    },
    async persistState(rowId, updates) {
      await writeRow(rowId, updates);
    }
  };
}
