/**
 * Slack Block Kit response formatters for the /ux-audit command.
 *
 * Block Kit reference: https://api.slack.com/reference/block-kit/blocks
 */

import type { UXIssue } from "@/lib/analyzer";

const SEVERITY_EMOJI: Record<UXIssue["severity"], string> = {
  critical: ":red_circle:",
  major: ":large_orange_circle:",
  minor: ":large_yellow_circle:",
};

const SEVERITY_ORDER: Record<UXIssue["severity"], number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

/** Maximum length for a Slack section text field (mrkdwn) — 3000 chars. */
const MAX_SECTION_LENGTH = 2900;

/** Return findings sorted critical > major > minor, preserving original order within each tier. */
export function sortFindings(findings: UXIssue[]): UXIssue[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/** Count findings by severity. */
export function summarizeFindings(findings: UXIssue[]): {
  critical: number;
  major: number;
  minor: number;
} {
  const counts = { critical: 0, major: 0, minor: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/** Slack mrkdwn escape — only * _ ~ ` and angle brackets are interpreted. */
function mrkdwnEscape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Truncate with ellipsis so we never exceed Slack limits. */
function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1))}\u2026`;
}

/**
 * Build the top-level blocks sent to `response_url` after the audit completes.
 *
 * Layout:
 *   1. Header with URL + timestamp
 *   2. Context with severity summary
 *   3. Up to 3 top findings (section per finding)
 *   4. Actions: "View full report" + "Push top issue to Asana"
 */
export function formatAuditBlocks(
  findings: UXIssue[],
  url: string,
  runId: string,
  appUrl: string,
): Record<string, unknown>[] {
  const sorted = sortFindings(findings);
  const top = sorted.slice(0, 3);
  const counts = summarizeFindings(findings);
  const reportUrl = `${appUrl.replace(/\/$/, "")}/report/${encodeURIComponent(runId)}`;
  const timestamp = new Date().toISOString();

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `UX audit: ${truncate(url, 140)}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*${counts.critical} critical* \u00b7 *${counts.major} major* \u00b7 *${counts.minor} minor* \u00b7 ${mrkdwnEscape(timestamp)}`,
        },
      ],
    },
  ];

  if (top.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":white_check_mark: No issues found. Nice work!",
      },
    });
  } else {
    blocks.push({ type: "divider" });
    top.forEach((issue, idx) => {
      const emoji = SEVERITY_EMOJI[issue.severity];
      const line = [
        `${emoji} *${idx + 1}. ${mrkdwnEscape(truncate(issue.title, 150))}*`,
        `_${mrkdwnEscape(truncate(issue.principle, 150))}_`,
        mrkdwnEscape(truncate(issue.suggested_fix, 500)),
      ].join("\n");

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncate(line, MAX_SECTION_LENGTH),
        },
      });
    });
  }

  // Action row — "View report" link + "Push top issue" button (if any)
  const actionElements: Record<string, unknown>[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "View full report", emoji: true },
      url: reportUrl,
      action_id: "view_report",
    },
  ];

  if (top.length > 0) {
    const topIssue = top[0];
    actionElements.push({
      type: "button",
      style: "primary",
      text: {
        type: "plain_text",
        text: "Push top issue to Asana",
        emoji: true,
      },
      // Value is used by the interactive handler to resolve the issue.
      // Keep under Slack's 2000-char action value limit.
      value: truncate(
        JSON.stringify({ runId, issueId: topIssue.id }),
        1900,
      ),
      action_id: "push_to_asana",
    });
  }

  blocks.push({ type: "actions", elements: actionElements });

  return blocks;
}

/**
 * Build a minimal error/notice response (used for validation failures or
 * when the audit pipeline itself throws).
 */
export function formatErrorBlocks(message: string): Record<string, unknown>[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: ${mrkdwnEscape(message)}`,
      },
    },
  ];
}
