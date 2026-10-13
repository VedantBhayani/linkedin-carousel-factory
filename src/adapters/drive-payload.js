import { WorkerError, describeThrown } from "../worker/errors.js";

// A 404 means the file is missing or not shared with the service account; retrying cannot
// fix that. Drive also answers rate limits with 403, so every other status stays retryable.
function toDriveError(error) {
  if (error instanceof WorkerError) return error;
  const { status, message } = describeThrown(error);
  if (status === 404) {
    return new WorkerError("configuration", "drive_file_not_found", `Drive file not found or not shared with the service account: ${message}`, error);
  }
  return new WorkerError("external", status === null ? "drive_request_failed" : `drive_http_${status}`, message, error);
}

export function extractDriveFileId(carouselFile) {
  if (typeof carouselFile !== "string") return null;
  const trimmed = carouselFile.trim();
  if (!trimmed) return null;
  const fileMatch = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(trimmed);
  if (fileMatch) return fileMatch[1];
  const openMatch = /[?&]id=([A-Za-z0-9_-]+)/.exec(trimmed);
  if (openMatch) return openMatch[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export function createDrivePayloadStore({ drive }) {
  if (!drive) throw new Error("drive client is required");
  return {
    async download(carouselFile) {
      const fileId = extractDriveFileId(carouselFile);
      if (!fileId) {
        throw new WorkerError("validation", "invalid_file_reference", "Carousel file reference is not a Drive file");
      }
      try {
        const meta = await drive.files.get({
          fileId,
          fields: "id,name,mimeType",
          supportsAllDrives: true
        });
        const media = await drive.files.get(
          { fileId, alt: "media", supportsAllDrives: true },
          { responseType: "arraybuffer" }
        );
        return { fileName: meta.data.name, bytes: Buffer.from(media.data) };
      } catch (error) {
        throw toDriveError(error);
      }
    }
  };
}
