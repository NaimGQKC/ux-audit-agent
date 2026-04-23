/**
 * Slack interactivity endpoint — handles Block Kit button clicks from the
 * `/ux-audit` response. Currently supports:
 *
 *   action_id: "push_to_asana"
 *     Resolves a finding by runId + issueId from the audit cache, creates an
 *     Asana task via the existing Asana module, and replies in-thread.
 *
 *   action_id: "view_report"
 *     No-op — Slack's URL buttons handle navigation client-side.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRawBody, verifySlackSignature } from "@/lib/slack/verify";
import { loadCachedAudit } from "@/lib/cache";
import {
  createTicket,
  type UXIssue as AsanaUXIssue,
} from "@/lib/asana";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Types (narrow subset of Slack's interaction payload)
// ---------------------------------------------------------------------------

interface SlackAction {
  action_id: string;
  value?: string;
}

interface BlockActionsPayload {
  type: "block_actions";
  response_url: string;
  user?: { id?: string; name?: string };
  actions: SlackAction[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    console.error("[slack/interactive] Failed to POST response_url:", err);
  }
}

/**
 * Walk the cached audit result and pull out the UXIssue matching `issueId`.
 * Returns the raw issue record (untyped) or null if not found.
 */
function findIssueInCache(runId: string, issueId: string): Record<string, unknown> | null {
  const cached = loadCachedAudit(runId);
  if (!cached) return null;

  const result = cached.result as { pages?: Array<{ viewports?: Record<string, { issues?: unknown[] }> }> } | null;
  const pages = result?.pages ?? [];
  for (const page of pages) {
    const viewports = page?.viewports ?? {};
    for (const vp of Object.values(viewports)) {
      const issues = Array.isArray(vp?.issues) ? vp.issues : [];
      for (const issue of issues) {
        if (
          issue &&
          typeof issue === "object" &&
          (issue as Record<string, unknown>).id === issueId
        ) {
          return issue as Record<string, unknown>;
        }
      }
    }
  }
  return null;
}

function toAsanaIssue(raw: Record<string, unknown>): AsanaUXIssue {
  // Coerce — the cached result already passed the analyzer validator.
  // We only copy the fields the Asana module cares about.
  const getString = (k: string) =>
    typeof raw[k] === "string" ? (raw[k] as string) : "";
  const viewports = Array.isArray(raw.affected_viewports)
    ? (raw.affected_viewports as unknown[]).filter(
        (v): v is "mobile" | "tablet" | "desktop" =>
          v === "mobile" || v === "tablet" || v === "desktop",
      )
    : [];

  const severity = raw.severity;
  const safeSeverity: AsanaUXIssue["severity"] =
    severity === "critical" || severity === "major" || severity === "minor"
      ? severity
      : "minor";

  return {
    title: getString("title"),
    description: getString("description"),
    severity: safeSeverity,
    category: getString("category"),
    ...(typeof raw.principle === "string" ? { principle: raw.principle } : {}),
    affected_element: getString("affected_element"),
    steps_to_reproduce: getString("steps_to_reproduce"),
    suggested_fix: getString("suggested_fix"),
    acceptance_criteria: getString("acceptance_criteria"),
    affected_viewports: viewports,
    recommendation: getString("recommendation"),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const rawBody = await getRawBody(request);
  const verified = await verifySlackSignature(request, rawBody);
  if (!verified) {
    return new NextResponse("Invalid Slack signature", { status: 401 });
  }

  // Slack sends interactivity payloads as form-encoded `payload=<json>`
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return NextResponse.json({ text: "Missing payload." });
  }

  let payload: BlockActionsPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return NextResponse.json({ text: "Malformed payload." });
  }

  if (payload.type !== "block_actions" || !Array.isArray(payload.actions)) {
    // Acknowledge anything else silently so Slack doesn't retry.
    return NextResponse.json({});
  }

  const action = payload.actions[0];
  const responseUrl = payload.response_url;
  const userId = payload.user?.id;

  // Noop for "view_report" — URL buttons don't need server action.
  if (action?.action_id !== "push_to_asana") {
    return NextResponse.json({});
  }

  // 1. Parse the action value ({ runId, issueId }).
  let runId = "";
  let issueId = "";
  try {
    const parsed = JSON.parse(action.value ?? "{}") as { runId?: string; issueId?: string };
    runId = parsed.runId ?? "";
    issueId = parsed.issueId ?? "";
  } catch {
    // fall through — validation below catches missing IDs
  }
  if (!runId || !issueId) {
    return NextResponse.json({
      response_type: "ephemeral",
      replace_original: false,
      text: ":warning: Missing runId or issueId in button payload.",
    });
  }

  // 2. ACK immediately — Slack requires <3s on interactive actions.
  //    Everything else runs in the background and posts to response_url.
  void (async () => {
    try {
      const raw = findIssueInCache(runId, issueId);
      if (!raw) {
        await postToResponseUrl(responseUrl, {
          response_type: "ephemeral",
          replace_original: false,
          text: `:warning: Couldn't find issue \`${issueId}\` in audit \`${runId}\`.`,
        });
        return;
      }

      const issue = toAsanaIssue(raw);
      const task = await createTicket(issue);

      await postToResponseUrl(responseUrl, {
        response_type: "in_channel",
        replace_original: false,
        // Thread the reply if this was invoked from a threaded message —
        // Slack uses thread_ts on the original message, but response_url
        // already targets the correct thread context so this is enough.
        text: `:white_check_mark: Created Asana task <${task.url}|${task.name}>${userId ? ` (pushed by <@${userId}>)` : ""}`,
      });
    } catch (err) {
      const message = (err as Error).message || "Unknown error";
      await postToResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: false,
        text: `:warning: Failed to create Asana task: ${message}`,
      });
    }
  })();

  // Empty 200 acknowledges the interaction without modifying the original message.
  return NextResponse.json({});
}
