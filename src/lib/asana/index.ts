/**
 * Asana module — Push approved UX issues as Asana tasks.
 *
 * Responsibilities:
 *  - Authenticate with Asana API via personal access token
 *  - Create tasks from approved UX issues with formatted descriptions
 *  - Map severity levels to Asana priority labels
 *  - Support batch creation with rate-limit-friendly delays
 *
 * Required env vars:
 *  - ASANA_ACCESS_TOKEN — Personal access token from Asana
 *  - ASANA_PROJECT_ID  — GID of the target Asana project
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "critical" | "major" | "minor";

export type AsanaPriority = "High" | "Medium" | "Low";

export type ViewportLabel = "mobile" | "tablet" | "desktop";

export interface UXIssue {
  title: string;
  description: string;
  severity: Severity;
  category: string;
  principle?: string;
  affected_element: string;
  steps_to_reproduce: string;
  suggested_fix: string;
  acceptance_criteria: string;
  affected_viewports: ViewportLabel[];
  recommendation: string;
  assignee?: string;
  /** Optional enrichment — surfaced into the task title / body / custom fields. */
  id?: string;
  source?: "llm" | "axe" | "lighthouse" | "tokens";
  wcag_ref?: string[];
  rule_id?: string;
  page_url?: string;
  run_id?: string;
  evidence_screenshot?: string;
}

export interface AsanaTaskResult {
  gid: string;
  name: string;
  url: string;
  /** Echoes `UXIssue.id` when supplied so callers can map results back to
   * the originating issue even when the batch has intermediate failures. */
  id?: string;
}

export interface AsanaBatchResult {
  created: AsanaTaskResult[];
  failed: { issue: UXIssue; error: string }[];
}

interface AsanaApiError {
  errors?: { message: string }[];
}

interface AsanaTaskResponse {
  data: {
    gid: string;
    name: string;
    permalink_url: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ASANA_API_BASE = "https://app.asana.com/api/1.0";

const SEVERITY_TO_PRIORITY: Record<Severity, AsanaPriority> = {
  critical: "High",
  major: "Medium",
  minor: "Low",
};

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "\u{1F534}",  // red circle
  major: "\u{1F7E0}",     // orange circle
  minor: "\u{1F7E1}",     // yellow circle
};

/** Delay between sequential task creations to avoid 429s (ms). */
const RATE_LIMIT_DELAY = 500;

/** Max batch size to avoid Next.js request timeouts. */
const MAX_BATCH_SIZE = 50;

/** HTTP status codes that indicate auth failure (no point retrying). */
const AUTH_FAILURE_CODES = [401, 403];

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

interface AsanaConfig {
  accessToken: string;
  projectId: string;
}

function getConfig(): AsanaConfig {
  const accessToken = process.env.ASANA_ACCESS_TOKEN;
  const projectId = process.env.ASANA_PROJECT_ID;

  if (!accessToken) {
    throw new Error(
      "ASANA_ACCESS_TOKEN is not set. Add it to your .env.local file."
    );
  }
  if (!projectId) {
    throw new Error(
      "ASANA_PROJECT_ID is not set. Add it to your .env.local file."
    );
  }

  return { accessToken, projectId };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function asanaRequest<T>(
  path: string,
  config: AsanaConfig,
  options: RequestInit = {}
): Promise<T> {
  const url = `${ASANA_API_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });

  const body = await res.json();

  if (!res.ok) {
    const apiError = body as AsanaApiError;
    const msg =
      apiError.errors?.map((e) => e.message).join("; ") ??
      `HTTP ${res.status}`;
    const error = new Error(`Asana API error (${res.status}): ${msg}`);
    (error as Error & { status: number }).status = res.status;
    throw error;
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function mapPriority(severity: Severity): AsanaPriority {
  return SEVERITY_TO_PRIORITY[severity];
}

function formatTaskName(issue: UXIssue): string {
  const priority = mapPriority(issue.severity);
  const emoji = SEVERITY_EMOJI[issue.severity];
  return `[UX-AUDIT · ${emoji} ${priority}] ${issue.title}`;
}

/**
 * Build a Langfuse trace link from LANGFUSE_TRACE_URL_TEMPLATE.
 * Template supports `{runId}` and `{issueId}` placeholders.
 * Returns null if no template or no runId.
 */
function buildLangfuseLink(issue: UXIssue): string | null {
  const template = process.env.LANGFUSE_TRACE_URL_TEMPLATE;
  if (!template || !issue.run_id) return null;
  return template
    .replace(/\{runId\}/g, encodeURIComponent(issue.run_id))
    .replace(/\{issueId\}/g, encodeURIComponent(issue.id ?? ""));
}

function formatTaskHtmlNotes(issue: UXIssue): string {
  // Asana html_notes is XML-strict and only supports a small tag set:
  // <body>, <h1>, <h2>, <strong>, <em>, <u>, <s>, <code>, <pre>,
  // <ol>, <ul>, <li>, <a>, <hr>, <img>, <blockquote>.
  // <p> and <br> are NOT allowed and will return "XML is invalid".
  // Use bare text between <h2> blocks for prose, <ul><li> for metadata.

  const priority = mapPriority(issue.severity);
  const emoji = SEVERITY_EMOJI[issue.severity];
  const viewports = (issue.affected_viewports ?? []).join(", ") || "all";

  const wcagLevel = (issue.wcag_ref ?? []).find((r) => /AA|AAA|A$/i.test(r)) ?? "";
  const source = issue.source ?? "llm";
  const langfuseLink = buildLangfuseLink(issue);

  const metaItems = [
    `<li>Severity: <strong>${emoji} ${escapeHtml(issue.severity)}</strong> (Priority: ${escapeHtml(priority)})</li>`,
    `<li>Category: <strong>${escapeHtml(issue.category)}</strong></li>`,
    `<li>Source: <strong>${escapeHtml(source)}</strong>${issue.rule_id ? ` (rule: <code>${escapeHtml(issue.rule_id)}</code>)` : ""}</li>`,
    `<li>Affected viewports: <strong>${escapeHtml(viewports)}</strong></li>`,
    issue.principle
      ? `<li>Principle: <strong>${escapeHtml(issue.principle)}</strong></li>`
      : "",
    issue.wcag_ref && issue.wcag_ref.length > 0
      ? `<li>WCAG: <strong>${escapeHtml(issue.wcag_ref.join(", "))}</strong>${wcagLevel ? ` (level ${escapeHtml(wcagLevel)})` : ""}</li>`
      : "",
    issue.page_url
      ? `<li>Page: <a href="${escapeHtml(issue.page_url)}">${escapeHtml(issue.page_url)}</a></li>`
      : "",
    issue.run_id
      ? `<li>Audit run: <code>${escapeHtml(issue.run_id)}</code></li>`
      : "",
    issue.id
      ? `<li>Issue ID: <code>${escapeHtml(issue.id)}</code> <em>(auto-closes when this issue no longer appears in a subsequent audit run)</em></li>`
      : "",
    langfuseLink
      ? `<li>Trace: <a href="${escapeHtml(langfuseLink)}">Langfuse trace</a></li>`
      : "",
  ].filter(Boolean).join("");

  // Guard every field — downstream data may have undefined if validation was skipped
  const safe = (s: string | undefined | null) => escapeHtml(s ?? "");

  return [
    "<body>",
    `<h2>Issue Description</h2>${safe(issue.description)}`,
    `<h2>Severity &amp; Category</h2><ul>${metaItems}</ul>`,
    `<h2>Affected Element</h2><code>${safe(issue.affected_element)}</code>`,
    `<h2>Steps to Reproduce</h2>${safe(issue.steps_to_reproduce)}`,
    `<h2>Suggested Fix</h2>${safe(issue.suggested_fix)}`,
    `<h2>Acceptance Criteria</h2>${safe(issue.acceptance_criteria)}`,
    `<h2>Recommendation</h2>${safe(issue.recommendation)}`,
    "</body>",
  ].join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a single Asana task from a UX issue.
 * Returns the created task's GID, name, and permalink URL.
 */
export async function createTicket(issue: UXIssue): Promise<AsanaTaskResult> {
  const config = getConfig();

  const payload: Record<string, unknown> = {
    data: {
      name: formatTaskName(issue),
      html_notes: formatTaskHtmlNotes(issue),
      projects: [config.projectId],
      ...(issue.assignee ? { assignee: issue.assignee } : {}),
    },
  };

  const result = await asanaRequest<AsanaTaskResponse>(
    "/tasks",
    config,
    { method: "POST", body: JSON.stringify(payload) }
  );

  return {
    gid: result.data.gid,
    name: result.data.name,
    url: result.data.permalink_url,
    ...(issue.id ? { id: issue.id } : {}),
  };
}

/**
 * Create multiple Asana tasks in sequence with a small delay between each
 * to stay under Asana's rate limits (~150 req/min).
 *
 * Returns both the successfully created tasks and any that failed.
 */
export async function createMultipleTickets(
  issues: UXIssue[]
): Promise<AsanaBatchResult> {
  if (issues.length > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch too large (${issues.length} issues). Max is ${MAX_BATCH_SIZE} to avoid timeouts. ` +
      `Split into smaller batches or filter by severity first.`
    );
  }

  const result: AsanaBatchResult = { created: [], failed: [] };
  let delay = RATE_LIMIT_DELAY;

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    try {
      const task = await createTicket(issue);
      result.created.push(task);
      delay = RATE_LIMIT_DELAY; // reset backoff on success
    } catch (err) {
      const status = (err as Error & { status?: number }).status;

      // Early exit on auth failures — no point retrying the rest
      if (status && AUTH_FAILURE_CODES.includes(status)) {
        result.failed.push({ issue, error: (err as Error).message });
        // Mark all remaining issues as failed
        for (let j = i + 1; j < issues.length; j++) {
          result.failed.push({
            issue: issues[j],
            error: `Skipped — auth failure on prior request (HTTP ${status})`,
          });
        }
        break;
      }

      result.failed.push({
        issue,
        error: (err as Error).message,
      });

      // Exponential backoff on rate limit (429)
      if (status === 429) {
        delay = Math.min(delay * 2, 5000);
      }
    }

    // Delay between requests (skip after the last one)
    if (i < issues.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return result;
}

// Re-export the priority mapper for consumers that need it
export { mapPriority };
