import { WorkerError } from "../worker/errors.js";

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
    }
  };
}
