/**
 * Error sanitization helpers.
 *
 * Why: several of our routes used to hand `(err as Error).message` back to the
 * caller directly. That leaks filesystem paths, stack traces, SDK internals,
 * command-injection-adjacent detail, and — in the audit pipeline — sometimes
 * enough to identify a user's home directory. This module gives every route
 * one place to decide "what's safe to send back" vs "what belongs in logs".
 *
 * Two modes:
 *  - `sanitizeError(err)` returns a short generic string safe to expose.
 *  - `logError(label, err)` writes the full error to server logs so we keep
 *    the diagnostic trail without shipping it over the wire.
 *
 * Call both: `logError("[route/foo]", err); return sanitizeError(err);`
 */

export interface SanitizedError {
  message: string;
  code?: string;
}

/**
 * Return a caller-safe string. Defaults to a generic message; only keeps
 * known-safe categories (HTTP status, "timed out", "not found", etc).
 */
export function sanitizeError(err: unknown, fallback = "Request failed. See server logs for details."): string {
  if (!err) return fallback;

  const raw = (err as Error).message || String(err);
  const lower = raw.toLowerCase();

  // Known-safe categories — don't leak detail, just the class.
  if (lower.includes("timed out") || lower.includes("etimedout") || lower.includes("timeout")) {
    return "Request timed out.";
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "Rate limit reached. Please try again shortly.";
  }
  if (lower.includes("abort")) {
    return "Request was aborted.";
  }
  if (lower.includes("unauthor") || lower.includes("forbidden") || lower.includes("401") || lower.includes("403")) {
    return "Authentication or authorization failed.";
  }
  if (lower.includes("not found") || lower.includes("404") || lower.includes("enoent")) {
    return "Requested resource not found.";
  }

  return fallback;
}

/**
 * Write the full error to server logs. Does not throw; safe in any catch.
 * Tags the log with a label so grep-ing the deploy logs is easy.
 */
export function logError(label: string, err: unknown): void {
  try {
    const e = err as Error;
    const status = (err as { status?: number }).status;
    const suffix = status ? ` [status=${status}]` : "";
    console.error(`${label}${suffix}: ${e?.message ?? err}`);
    if (e?.stack && process.env.NODE_ENV !== "production") {
      console.error(e.stack);
    }
  } catch {
    // never let logging blow up the handler
  }
}
