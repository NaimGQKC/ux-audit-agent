/**
 * Slack request signature verification.
 *
 * Slack signs every request using HMAC-SHA256 with the signing secret from
 * the app's "Basic Information" page. We verify the signature against the
 * raw request body (formData() consumes it, so we cache the raw bytes).
 *
 * Spec: https://api.slack.com/authentication/verifying-requests-from-slack
 */

import crypto from "node:crypto";

/**
 * Maximum allowed clock skew between Slack and this server.
 * Slack recommends 5 minutes to protect against replay attacks.
 */
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

/**
 * Read and return the raw request body as a UTF-8 string.
 *
 * Must be called BEFORE any other body-consuming method (e.g. request.formData,
 * request.json) because a Request body can only be read once.
 *
 * Returns a fresh copy of the bytes so the caller can re-parse the form data
 * via `new URLSearchParams(rawBody)`.
 */
export async function getRawBody(req: Request): Promise<string> {
  return await req.text();
}

/**
 * Verify a Slack request signature.
 *
 * Compares the `x-slack-signature` header against an HMAC-SHA256 computed
 * from `v0:<timestamp>:<rawBody>` using the `SLACK_SIGNING_SECRET` env var.
 *
 * Uses `crypto.timingSafeEqual` to prevent timing attacks. Rejects stale
 * requests (> 5 min) to mitigate replay.
 *
 * Returns `true` only when:
 *  - `SLACK_SIGNING_SECRET` is configured
 *  - both required headers are present
 *  - timestamp skew is within the allowed window
 *  - signatures match exactly
 */
export async function verifySlackSignature(
  request: Request,
  rawBody: string,
): Promise<boolean> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    // Fail closed — never accept requests when the secret is missing.
    console.error("[slack/verify] SLACK_SIGNING_SECRET is not configured");
    return false;
  }

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  // Replay protection — reject requests with timestamps > 5 min off
  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const computed = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex")}`;

  // Both buffers must be the same length before timingSafeEqual
  const computedBuf = Buffer.from(computed, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  if (computedBuf.length !== signatureBuf.length) return false;

  try {
    return crypto.timingSafeEqual(computedBuf, signatureBuf);
  } catch {
    return false;
  }
}
