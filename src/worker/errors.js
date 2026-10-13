export class WorkerError extends Error {
  constructor(type, code, message, cause) {
    super(message);
    this.name = "WorkerError";
    this.type = type;
    this.code = code;
    this.cause = cause;
  }
}

export class AmbiguousExternalError extends WorkerError {
  constructor(code, message, cause) {
    super("ambiguous", code, message, cause);
    this.name = "AmbiguousExternalError";
  }
}

// Exact credential values configured for this process. Pattern-based scrubbing misses
// short or numeric keys (a Cloudinary API key is 15 digits), so known values are removed
// verbatim from every Sheet error and log line.
const secretValues = new Set();

export function registerSecretValues(values) {
  for (const value of values) {
    if (typeof value === "string" && value.length >= 4) secretValues.add(value);
  }
}

export function clearSecretValues() {
  secretValues.clear();
}

function redactSecretValues(text) {
  let redacted = text;
  for (const value of secretValues) {
    redacted = redacted.split(value).join("[secret]");
  }
  return redacted;
}

export function redactForLog(message) {
  return redactSecretValues(String(message ?? ""))
    .replace(/https?:\/\/[^\s"']+/g, "[url]")
    .replace(/ya29\.[A-Za-z0-9-_]+/g, "[token]")
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, "[key]")
    .slice(0, 500);
}

// Provider SDKs do not all throw Error instances. The Cloudinary Admin API rejects with
// { request_options, query_params, error: { message, http_code } }, its uploader with
// { message, http_code }, and googleapis with a GaxiosError carrying `status`.
export function describeThrown(error) {
  if (error === null || error === undefined || typeof error !== "object") {
    return { status: null, message: String(error ?? "") };
  }
  const nested = error.error && typeof error.error === "object" ? error.error : null;
  const rawStatus = nested?.http_code ?? error.http_code ?? error.status ?? error.response?.status ?? null;
  const status = Number.isInteger(rawStatus) ? rawStatus : null;
  const rawMessage = nested?.message ?? error.message ?? "";
  return { status, message: typeof rawMessage === "string" ? rawMessage : String(rawMessage) };
}

export function toWorkerError(error) {
  if (error instanceof WorkerError) return error;
  const { status, message } = describeThrown(error);
  return new WorkerError("external", status === null ? "unknown" : `http_${status}`, message, error);
}

const SANITIZE_PATTERNS = [
  /https?:\/\/[^\s]+/g,
  /ya29\.[A-Za-z0-9\-_]+/g,
  /[A-Za-z0-9\-_]{20,}/g,
  /\{[\s\S]*\}/g,
  /\b(at\s+\S+\s*\([\s\S]*?\))/g,
  /\b(render\.js|validation\.js|document\.js|renderCarousel|main)\b/g,
  /\n/g,
];

function sanitize(message) {
  let sanitized = redactSecretValues(message);
  for (const pattern of SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized.replace(/\s+/g, " ").trim();
}

const MAX_SAFE_LENGTH = 240;

export function toSafeQueueError(error) {
  const prefix = `${error.type}:${error.code}`;
  const sanitized = sanitize(error.message || "");
  const combined = `${prefix} ${sanitized}`;
  if (combined.length > MAX_SAFE_LENGTH) {
    return { code: error.code, message: combined.slice(0, MAX_SAFE_LENGTH - 3) + "..." };
  }
  return { code: error.code, message: combined };
}