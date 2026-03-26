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
  affected_element: string;
  steps_to_reproduce: string;
  suggested_fix: string;
  acceptance_criteria: string;
  affected_viewports: ViewportLabel[];
  recommendation: string;
  assignee?: string;
}

export interface AsanaTaskResult {
  gid: string;
  name: string;
  url: string;
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
const RATE_LIMIT_DELAY = 350;

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
    throw new Error(`Asana API error: ${msg}`);
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
  return `[${priority.toUpperCase()}] ${issue.title}`;
}

function formatTaskHtmlNotes(issue: UXIssue): string {
  const priority = mapPriority(issue.severity);
  const emoji = SEVERITY_EMOJI[issue.severity];
  const viewports = issue.affected_viewports.join(", ");

  return [
    "<body>",
    `<h2>Issue Description</h2>`,
    `<p>${escapeHtml(issue.description)}</p>`,
    "",
    `<h2>Severity &amp; Category</h2>`,
    `<p>${emoji} <strong>${escapeHtml(issue.severity)}</strong> (Priority: ${escapeHtml(priority)}) · Category: <strong>${escapeHtml(issue.category)}</strong></p>`,
    `<p>Affected viewports: <strong>${escapeHtml(viewports)}</strong></p>`,
    "",
    `<h2>Affected Element</h2>`,
    `<p><code>${escapeHtml(issue.affected_element)}</code></p>`,
    "",
    `<h2>Steps to Reproduce</h2>`,
    `<p>${escapeHtml(issue.steps_to_reproduce)}</p>`,
    "",
    `<h2>Suggested Fix</h2>`,
    `<p>${escapeHtml(issue.suggested_fix)}</p>`,
    "",
    `<h2>Acceptance Criteria</h2>`,
    `<p>${escapeHtml(issue.acceptance_criteria)}</p>`,
    "",
    `<h2>Recommendation</h2>`,
    `<p>${escapeHtml(issue.recommendation)}</p>`,
    "</body>",
  ].join("\n");
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
  const result: AsanaBatchResult = { created: [], failed: [] };

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    try {
      const task = await createTicket(issue);
      result.created.push(task);
    } catch (err) {
      result.failed.push({
        issue,
        error: (err as Error).message,
      });
    }

    // Delay between requests (skip after the last one)
    if (i < issues.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  return result;
}

// Re-export the priority mapper for consumers that need it
export { mapPriority };
