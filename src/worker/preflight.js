import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGoogleClients } from "../adapters/google-auth.js";
import { rowToJob, SHEET_COLUMNS } from "../adapters/sheets-queue.js";
import { extractDriveFileId } from "../adapters/drive-payload.js";
import { stageFor, expiredLockStage, SAFE_JOB_ID } from "./job-state.js";
import { describeThrown, redactForLog, registerSecretValues } from "./errors.js";

// Read-only check of the queue before a real run. It never writes to the Sheet, never
// downloads payloads, and never prints post text.

const KNOWN_STATUSES = new Set([
  // Written by the scheduled tasks
  "queued", "processing", "brief_created", "carousel_processing", "carousel_created", "failed", "needs_human",
  // Written by the GitHub worker
  "rendering", "render_retry", "render_created", "render_failed",
  "drafting", "draft_retry", "draft_created", "draft_failed"
]);

const REQUIRED_COLUMNS = SHEET_COLUMNS.filter((name) => name !== "brief_file");

export function analyzeSheet(values, now = new Date(), sheetName = "Sheet1") {
  const header = (values[0] ?? []).map((name) => String(name).trim());
  const missingHeaders = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  if (missingHeaders.length > 0) {
    return { ok: false, missingHeaders, rows: [], duplicateGroups: [], next: null };
  }

  const jobIdIndex = header.indexOf("job_id");
  const rows = values.slice(1).map((cells, i) => {
    const job = rowToJob(values[0], cells, i + 2, sheetName);
    const rawJobId = String(cells[jobIdIndex] ?? "");
    const issues = [];
    if (job.jobId && rawJobId !== job.jobId) issues.push("job_id has surrounding whitespace (the worker trims it)");
    if (job.jobId && !SAFE_JOB_ID.test(job.jobId)) issues.push("unsafe job_id (use letters, digits, hyphens, underscores)");
    if (job.status && !KNOWN_STATUSES.has(job.status)) issues.push(`unknown status "${job.status}"`);
    if (job.status === "carousel_created" && !extractDriveFileId(job.carouselFile)) {
      issues.push("carousel_file is not a Drive file reference");
    }
    return { rowId: job.rowId, jobId: job.jobId, status: job.status, issues, job };
  });

  const byText = new Map();
  for (const row of rows) {
    const text = String(row.job.postText ?? "").trim();
    if (!text) continue;
    byText.set(text, [...(byText.get(text) ?? []), row.rowId]);
  }
  const duplicateGroups = [...byText.values()].filter((group) => group.length > 1);

  let next = null;
  for (const row of rows) {
    if (!row.jobId) continue;
    const stage = expiredLockStage(row.job, now) ? "expire" : stageFor(row.job, now);
    if (stage) {
      next = { rowId: row.rowId, jobId: row.jobId, stage, carouselFile: row.job.carouselFile };
      break;
    }
  }

  const blocking = rows.some((row) => row.issues.some((issue) => !issue.startsWith("job_id has surrounding")));
  return {
    ok: !blocking && duplicateGroups.length === 0,
    missingHeaders,
    rows: rows.map(({ job, ...row }) => row),
    duplicateGroups,
    next
  };
}

export function formatReport(report) {
  const lines = [];
  if (report.missingHeaders.length > 0) {
    lines.push(`missing headers: ${report.missingHeaders.join(", ")}`);
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(`${row.rowId} ${row.jobId || "(no job_id)"} ${row.status || "(no status)"}${row.issues.length ? ` ISSUES: ${row.issues.join("; ")}` : ""}`);
  }
  for (const group of report.duplicateGroups) {
    lines.push(`duplicate post_text: ${group.join(", ")} (the worker will stop these rows)`);
  }
  lines.push(report.next ? `next: ${report.next.rowId} ${report.next.jobId} ${report.next.stage}` : "next: none (worker would be idle)");
  lines.push(`result: ${report.ok ? "ok" : "problems found"}`);
  return lines.join("\n");
}

export async function checkNextPayload(drive, next) {
  if (!next || next.stage !== "render") return { ok: true, message: "no payload to check" };
  const fileId = extractDriveFileId(next.carouselFile);
  if (!fileId) return { ok: false, message: "carousel_file is not a Drive file reference" };
  try {
    const meta = await drive.files.get({ fileId, fields: "id,name,mimeType", supportsAllDrives: true });
    const name = String(meta.data.name ?? "");
    const expected = `${next.jobId}-carousel-v1.json`;
    const ok = name.trim() === expected;
    return { ok, message: `Drive file "${name}" (${meta.data.mimeType}) ${ok ? "matches" : `does not match ${expected}`}` };
  } catch (error) {
    const { status, message } = describeThrown(error);
    return { ok: false, message: `Drive metadata read failed (${status ?? "no status"}): ${redactForLog(message)}` };
  }
}

async function main() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = process.env.SHEET_SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || "Sheet1";
  if (!serviceAccountJson || !spreadsheetId) {
    console.error("preflight needs GOOGLE_SERVICE_ACCOUNT_JSON and SHEET_SPREADSHEET_ID");
    process.exitCode = 1;
    return;
  }
  try {
    const account = JSON.parse(serviceAccountJson);
    registerSecretValues([account.private_key, account.private_key_id]);
  } catch {
    // createGoogleClients reports malformed JSON.
  }
  try {
    const { sheets, drive } = createGoogleClients({ serviceAccountJson });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
    const report = analyzeSheet(response.data.values ?? [], new Date(), sheetName);
    console.log(formatReport(report));
    const payload = await checkNextPayload(drive, report.next);
    console.log(`payload: ${payload.message}`);
    process.exitCode = report.ok && payload.ok ? 0 : 1;
  } catch (error) {
    const { status, message } = describeThrown(error);
    console.error(`preflight failed (${status ?? "no status"}): ${redactForLog(message)}`);
    process.exitCode = 1;
  }
}

const isMain = import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href;
if (isMain) {
  await main();
}
