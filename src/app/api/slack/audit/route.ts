/**
 * Slack slash-command endpoint: `/ux-audit <url>`
 *
 * Flow:
 *  1. Slack POSTs an `application/x-www-form-urlencoded` payload with the
 *     command text and a `response_url` we can call back for up to 30 min.
 *  2. We verify the request signature (HMAC-SHA256, 5-min skew window).
 *  3. We return a 200 with an ephemeral "Auditing..." message within 3 s.
 *  4. In the background, we drive the existing audit pipeline by POSTing to
 *     our own `/api/audit` route and consuming its SSE stream.
 *  5. When the audit completes, we POST a Block Kit message to `response_url`
 *     with the top findings + a link to the full report + Asana action.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRawBody, verifySlackSignature } from "@/lib/slack/verify";
import { formatAuditBlocks, formatErrorBlocks } from "@/lib/slack/format";
import { findCachedAudits } from "@/lib/cache";
import { validateAnalysisResult, type UXIssue } from "@/lib/analyzer";

export const dynamic = "force-dynamic";
// The user-facing ACK is fast, but the background audit can run for minutes.
// Next dev server will hold the handler open until the background task settles.
export const maxDuration = 900;

// ---------------------------------------------------------------------------
// URL validation (duplicated from audit route — we can't import private fns)
// ---------------------------------------------------------------------------

/**
 * Allow only http/https URLs pointing at public hosts.
 * Rejects loopback, link-local, and RFC1918 private ranges to prevent SSRF
 * from a Slack-triggered audit.
 */
function validatePublicUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "URL must start with http:// or https://" };
  }

  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("169.254.") ||
    host.endsWith(".local") ||
    host.endsWith(".internal");

  if (isPrivate) {
    return { ok: false, error: "Private-network URLs (localhost, RFC1918, .local) aren't allowed." };
  }

  return { ok: true, url: url.toString() };
}

// ---------------------------------------------------------------------------
// Slack helpers
// ---------------------------------------------------------------------------

function ephemeralJson(text: string, blocks?: Record<string, unknown>[]): NextResponse {
  return NextResponse.json({
    response_type: "ephemeral",
    text,
    ...(blocks ? { blocks } : {}),
  });
}

function usageBlocks(): Record<string, unknown>[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Usage*\n" +
          "`/ux-audit https://staging.example.com` \u2014 run an audit and reply here with the top findings.\n" +
          "`/ux-audit help` \u2014 show this message.\n\n" +
          "Only public http(s) URLs are accepted. Private-network hosts (localhost, 10.*, 192.168.*) are blocked.",
      },
    },
  ];
}

/** POST a Block Kit payload back to Slack's response_url. Best-effort. */
async function postToResponseUrl(
  responseUrl: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[slack/audit] Failed to POST response_url:", err);
  }
}

// ---------------------------------------------------------------------------
// Audit driver — invokes the existing /api/audit SSE endpoint
// ---------------------------------------------------------------------------

interface AuditOutcome {
  baseUrl: string;
  findings: UXIssue[];
  runId: string;
}

/**
 * Drive the existing audit pipeline by POSTing to our own SSE endpoint and
 * collecting the final `result` event. The audit route already persists the
 * result to the on-disk cache, so we grab the cache ID (= runId) after the
 * fact via `findCachedAudits`.
 */
async function runAuditForSlack(url: string, appUrl: string): Promise<AuditOutcome> {
  const auditEndpoint = `${appUrl.replace(/\/$/, "")}/api/audit`;

  const res = await fetch(auditEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ url, skipDeterministic: false }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Audit endpoint returned HTTP ${res.status}`);
  }

  // Stream-parse SSE events — we only care about `result` and `error`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: { baseUrl: string; timestamp: string; pages: unknown[] } | null = null;
  let streamError: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE blocks (separated by blank lines)
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let eventName = "message";
      const dataLines: string[] = [];
      for (const rawLine of chunk.split("\n")) {
        if (rawLine.startsWith(":")) continue; // heartbeat comment
        if (rawLine.startsWith("event:")) eventName = rawLine.slice(6).trim();
        else if (rawLine.startsWith("data:")) dataLines.push(rawLine.slice(5).trim());
      }
      if (dataLines.length === 0) continue;

      const dataStr = dataLines.join("\n");
      try {
        const parsed = JSON.parse(dataStr);
        if (eventName === "result") {
          finalResult = parsed;
        } else if (eventName === "error") {
          streamError = typeof parsed?.message === "string" ? parsed.message : "Audit failed";
        }
      } catch {
        // Non-JSON event — ignore
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!finalResult) throw new Error("Audit stream ended without a result event");

  // Flatten all issues across pages & viewports into a single list.
  const findings: UXIssue[] = [];
  const pages = Array.isArray(finalResult.pages) ? finalResult.pages : [];
  for (const page of pages as Array<{ viewports?: Record<string, { issues?: unknown[] }> }>) {
    const viewports = page?.viewports ?? {};
    for (const vp of Object.values(viewports)) {
      const rawIssues = Array.isArray(vp?.issues) ? vp.issues : [];
      if (rawIssues.length === 0) continue;
      try {
        const validated = validateAnalysisResult({ issues: rawIssues });
        findings.push(...validated.issues);
      } catch {
        // Skip viewports with malformed issues — don't fail the whole audit
      }
    }
  }

  // The audit route writes to disk via saveAuditToCache(). Look up the
  // most recent cache entry for this URL — it's what we use as runId for
  // the report link and for later Asana push lookups.
  const cached = findCachedAudits(finalResult.baseUrl);
  const runId = cached[0]?.id ?? `${Date.now()}`;

  return { baseUrl: finalResult.baseUrl, findings, runId };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Read raw body FIRST so we can verify the HMAC signature.
  const rawBody = await getRawBody(request);
  const verified = await verifySlackSignature(request, rawBody);
  if (!verified) {
    return new NextResponse("Invalid Slack signature", { status: 401 });
  }

  // 2. Parse the form payload.
  const params = new URLSearchParams(rawBody);
  const text = (params.get("text") ?? "").trim();
  const responseUrl = params.get("response_url") ?? "";
  const userId = params.get("user_id") ?? "";

  if (!responseUrl) {
    return ephemeralJson("Missing response_url in Slack payload.");
  }

  // 3. Handle `help` / empty
  if (!text || text.toLowerCase() === "help") {
    return ephemeralJson("Usage for /ux-audit", usageBlocks());
  }

  // 4. Validate the URL argument.
  const validation = validatePublicUrl(text.split(/\s+/)[0]);
  if (!validation.ok) {
    return ephemeralJson(
      `:warning: ${validation.error}`,
      formatErrorBlocks(validation.error + "  Try `/ux-audit help`."),
    );
  }
  const targetUrl = validation.url;

  // 5. Resolve the app URL (used to build report links + call our own /api/audit).
  const appUrl =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    new URL(request.url).origin;

  // 6. Kick off the audit in the background. Fire-and-forget — we MUST reply
  //    within 3s so Slack doesn't time the command out.
  void (async () => {
    try {
      const { findings, runId } = await runAuditForSlack(targetUrl, appUrl);
      const blocks = formatAuditBlocks(findings, targetUrl, runId, appUrl);
      await postToResponseUrl(responseUrl, {
        response_type: "in_channel",
        replace_original: false,
        text: `UX audit complete for ${targetUrl}`,
        blocks,
      });
    } catch (err) {
      const message = (err as Error).message || "Unknown error";
      await postToResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: false,
        text: `:warning: Audit failed: ${message}`,
        blocks: formatErrorBlocks(`Audit failed: ${message}`),
      });
    }
  })();

  // 7. Immediate ephemeral ACK (only the invoker sees this).
  return NextResponse.json({
    response_type: "ephemeral",
    text: `:mag: Auditing ${targetUrl}\u2026 this can take a few minutes. I'll post the top findings in this channel when it's done.${userId ? ` (requested by <@${userId}>)` : ""}`,
  });
}
