import { google } from "googleapis";
import { WorkerError } from "../worker/errors.js";

export function createGoogleClients({ serviceAccountJson } = {}) {
  if (!serviceAccountJson) {
    throw new WorkerError("configuration", "missing_service_account", "Google service account JSON is required");
  }
  let credentials;
  try {
    credentials = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  } catch (error) {
    throw new WorkerError("configuration", "invalid_service_account", "Google service account JSON is malformed");
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new WorkerError("configuration", "invalid_service_account", "Service account needs client_email and private_key");
  }
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.readonly"]
  });
  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth })
  };
}
