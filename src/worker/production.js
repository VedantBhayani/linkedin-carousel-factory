import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGoogleClients } from "../adapters/google-auth.js";
import { createSheetJobQueue } from "../adapters/sheets-queue.js";
import { createDrivePayloadStore } from "../adapters/drive-payload.js";
import { createCloudinaryAssetStore } from "../adapters/cloudinary-assets.js";
import { createBufferDraftService } from "../adapters/buffer-drafts.js";
import { renderCarousel } from "../render.js";
import { createWorkerRunner } from "./main.js";
import { WorkerError } from "./errors.js";

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
    }
  };
}

export function createProductionRunner(config) {
  const { sheets, drive } = createGoogleClients({ serviceAccountJson: config.serviceAccountJson });
  const ports = {
    JobQueue: createSheetJobQueue({
      sheets,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName
    }),
    PayloadStore: createDrivePayloadStore({ drive }),
    CarouselRenderer: { render: (options) => renderCarousel(options) },
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

async function main() {
  try {
    const run = createProductionRunner(loadProductionConfig());
    const result = await run();
    console.log(JSON.stringify({ outcome: result.outcome, error: result.error ?? null }));
  } catch (error) {
    console.error(error instanceof WorkerError ? `${error.type}:${error.code} ${error.message}` : (error.stack || error.message));
    process.exitCode = 1;
  }
}

const isMain = import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href;
if (isMain) {
  await main();
}
