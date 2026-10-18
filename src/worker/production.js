import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGoogleClients } from "../adapters/google-auth.js";
import { createSheetJobQueue } from "../adapters/sheets-queue.js";
import { createDrivePayloadStore } from "../adapters/drive-payload.js";
import { createCloudinaryAssetStore } from "../adapters/cloudinary-assets.js";
import { createBufferDraftService } from "../adapters/buffer-drafts.js";
import { renderCarousel } from "../render.js";
import { loadEmbeddedFontCss } from "../fonts.js";
import { createWorkerRunner } from "./main.js";
import { WorkerError, registerSecretValues, redactForLog } from "./errors.js";

const REQUIRED_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "SHEET_SPREADSHEET_ID",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "BUFFER_API_KEY",
  "BUFFER_CHANNEL_ID"
];

export function loadProductionConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new WorkerError(
      "configuration",
      "missing_production_config",
      `Missing production configuration: ${missing.join(", ")}`
    );
  }
  return {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
    spreadsheetId: env.SHEET_SPREADSHEET_ID,
    sheetName: env.SHEET_NAME ?? "Sheet1",
    cloudinary: {
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET
    },
    buffer: {
      apiKey: env.BUFFER_API_KEY,
      channelId: env.BUFFER_CHANNEL_ID
    },
    fontDir: env.CAROUSEL_FONT_DIR
  };
}

export function secretValuesFor(config) {
  const values = [config.cloudinary.apiKey, config.cloudinary.apiSecret, config.buffer.apiKey];
  try {
    const account = JSON.parse(config.serviceAccountJson);
    values.push(account.private_key, account.private_key_id);
  } catch {
    // Malformed JSON is reported by createGoogleClients as a configuration error.
  }
  return values.filter((value) => typeof value === "string" && value.length > 0);
}

export function createProductionRunner(config) {
  // Validated before any adapter exists, so a bad font directory can never claim a row.
  const fontCss = loadEmbeddedFontCss({ fontDir: config.fontDir });
  registerSecretValues(secretValuesFor(config));
  const { sheets, drive } = createGoogleClients({ serviceAccountJson: config.serviceAccountJson });
  const ports = {
    JobQueue: createSheetJobQueue({
      sheets,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName
    }),
    PayloadStore: createDrivePayloadStore({ drive }),
    CarouselRenderer: { render: (options) => renderCarousel({ ...options, fontCss }) },
    AssetStore: createCloudinaryAssetStore({
      cloudName: config.cloudinary.cloudName,
      apiKey: config.cloudinary.apiKey,
      apiSecret: config.cloudinary.apiSecret
    }),
    DraftService: createBufferDraftService({
      apiKey: config.buffer.apiKey,
      channelId: config.buffer.channelId
    })
  };
  return createWorkerRunner({
    ports,
    clock: { now: () => new Date() },
    createWorkerId: () => `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  });
}

const STAGE_BY_OUTCOME = { render_created: "render", draft_created: "draft" };

// One machine-readable line per run. A failed job exits non-zero so the GitHub Actions
// run turns red and GitHub's failure notification fires; before this every run was green.
export function summarizeRun(result) {
  const jobId = result.jobId ?? result.manifest?.jobId ?? null;
  const stage = result.stage ?? STAGE_BY_OUTCOME[result.outcome] ?? null;
  return {
    line: JSON.stringify({ outcome: result.outcome, error: result.error ?? null, jobId, stage }),
    exitCode: result.outcome === "failed" ? 1 : 0
  };
}

export function resolveStartupMode(env = process.env) {
  const anySet = REQUIRED_ENV.some((key) => env[key]);
  return anySet ? { mode: "run" } : { mode: "skip" };
}

async function main() {
  try {
    if (resolveStartupMode().mode === "skip") {
      console.log("Production is not configured, skipping worker run.");
      return;
    }
    const run = createProductionRunner(loadProductionConfig());
    const summary = summarizeRun(await run());
    console.log(summary.line);
    process.exitCode = summary.exitCode;
  } catch (error) {
    console.error(redactForLog(error instanceof WorkerError ? `${error.type}:${error.code} ${error.message}` : (error.stack || error.message)));
    process.exitCode = 1;
  }
}

const isMain = import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href;
if (isMain) {
  await main();
}
