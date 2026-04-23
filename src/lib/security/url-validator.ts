/**
 * Shared URL validator — SSRF defense for every entrypoint that takes a
 * user-supplied URL and hands it to Playwright / fetch / Lighthouse.
 *
 * Rejects:
 *  - non-http(s) protocols (file:, data:, javascript:, ftp:, ...)
 *  - loopback + RFC1918 private ranges
 *  - link-local (169.254/16) — covers cloud metadata endpoints
 *    (AWS IMDS, GCP metadata, Azure IMDS all resolve here)
 *  - 100.64/10 carrier-grade NAT
 *  - fly-local-6pn (Fly.io internal 6PN mesh)
 *  - *.internal / *.local — common private TLDs
 *
 * Callers that legitimately need to audit localhost (audit_local on the
 * stdio server, dev-mode audit API) pass `allowPrivate: true` and use the
 * `validateLocalUrl` variant. Private URLs are otherwise NEVER allowed.
 */

// Fly.io exposes an internal metadata address at `fly-local-6pn` (ULA fd00::/8
// on the 6PN mesh). Block it by hostname match.
const FLY_METADATA_HOSTS = new Set(["fly-local-6pn", "_api.internal", "fly.local"]);

// Cloud provider metadata IPs beyond 169.254.169.254 — keep this list narrow
// but explicit. Any link-local hit is already blocked by the regex below.
const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

export interface UrlValidationResult {
  ok: boolean;
  url?: string;
  error?: string;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();

  if (
    h === "localhost" ||
    h === "ip6-localhost" ||
    h === "ip6-loopback" ||
    h === "[::1]" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h === "[::]" ||
    h === "::"
  ) {
    return true;
  }

  if (FLY_METADATA_HOSTS.has(h) || METADATA_HOSTS.has(h)) return true;

  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) {
    return true;
  }

  // IPv4 private ranges
  if (/^127\./.test(h)) return true;            // loopback
  if (/^10\./.test(h)) return true;             // RFC1918 /8
  if (/^192\.168\./.test(h)) return true;       // RFC1918 /16
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // RFC1918 /12
  if (/^169\.254\./.test(h)) return true;       // link-local — covers metadata
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true; // CGNAT 100.64/10

  // IPv6 private/reserved prefixes (bracket or bare)
  const stripped = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  if (/^f[cd][0-9a-f]{2}:/i.test(stripped)) return true; // fc00::/7 — unique local
  if (/^fe[89ab][0-9a-f]:/i.test(stripped)) return true; // fe80::/10 — link-local
  if (stripped === "::ffff:127.0.0.1" || /^::ffff:127\./i.test(stripped)) return true; // v4-mapped loopback

  return false;
}

/**
 * Validate a URL intended for an external audit target (audit_page, audit_site,
 * quick_scan, Slack-triggered audits, the Next.js audit API in production).
 * Rejects every non-public target.
 */
export function validatePublicUrl(input: unknown): UrlValidationResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "URL is required." };
  }
  if (input.length > 2048) {
    return { ok: false, error: "URL is too long." };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must use http or https." };
  }

  // Never allow embedded credentials — surprising and exfiltration-friendly.
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with embedded credentials are not allowed." };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return { ok: false, error: "URL is missing a hostname." };
  }

  if (isPrivateHost(host)) {
    return {
      ok: false,
      error: "Private-network URLs (localhost, RFC1918, link-local, metadata) are not allowed.",
    };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Validate a URL intended for the local dev server — loopback + dev ports OK,
 * everything else still rejected. Used by audit_local (shield) and by the
 * Next dashboard audit API when NODE_ENV !== "production".
 */
export function validateLocalUrl(input: unknown): UrlValidationResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "URL is required." };
  }
  if (input.length > 2048) {
    return { ok: false, error: "URL is too long." };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must use http or https." };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with embedded credentials are not allowed." };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return { ok: false, error: "URL is missing a hostname." };
  }

  // Allow only loopback — everything else private is still out (e.g. RFC1918
  // is suspicious even on a dev box, and metadata endpoints are never OK).
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1";

  if (!isLoopback) {
    // Defer to the stricter validator so .local / RFC1918 / metadata are
    // uniformly rejected here too.
    return validatePublicUrl(input);
  }

  return { ok: true, url: parsed.toString() };
}
