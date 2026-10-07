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
  let sanitized = message;
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