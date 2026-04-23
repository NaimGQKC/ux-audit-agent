/**
 * Shared chat-friendly formatter for pipeline results.
 *
 * Every MCP tool returns text — Claude / claude.ai chat renders it as
 * markdown. Keep the format consistent across tools so the reader's
 * scan-pattern stays stable whether they called audit_page or audit_site.
 */

import type { PipelineResult } from "@/lib/pipelines";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

export function formatPipelineResult(result: PipelineResult, title?: string): string {
  if (result.pages.length === 0) {
    return `${title ? `**${title}**\n\n` : ""}No pages were analyzed.`;
  }

  const lines: string[] = [];
  if (title) lines.push(`**${title}**`);
  lines.push(`_Transport: ${result.transport} · ${result.pages.length} page(s)_`);
  if (result.reportUrl) {
    // Surface the web-UI viewer URL at the top. The viewer has the
    // approve/dismiss/edit + push-to-Asana flow that the MCP chat can't; this
    // link is the "exit ramp" from read-only preview to full triage.
    lines.push(`**Triage in browser:** ${result.reportUrl}`);
  }
  lines.push("");

  let totalIssues = 0;
  for (const page of result.pages) {
    lines.push(`## ${page.url}`);
    if (page.issues.length === 0) {
      lines.push("No issues found.\n");
      continue;
    }

    const sorted = [...page.issues].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
    );

    for (const issue of sorted) {
      totalIssues++;
      lines.push(`### [${issue.severity.toUpperCase()}] ${issue.title}`);
      lines.push(`- **Principle:** ${issue.principle}`);
      lines.push(`- **Element:** \`${issue.affected_element}\``);
      lines.push(`- **Description:** ${issue.description}`);
      lines.push(`- **Fix:** ${issue.recommendation}`);
      lines.push(`- **Acceptance criteria:** ${issue.acceptance_criteria}`);
      lines.push("");
    }
  }

  const summary = `Found **${totalIssues} issue(s)** across ${result.pages.length} page(s).`;

  // Footer: next-step hints. Two action paths are useful — the web UI (full
  // triage + canonical Asana push with the XML-strict html_notes formatter),
  // and direct Asana MCP calls from claude.ai chat using the structured
  // findings above. Keep it short; users read this at the bottom after
  // scanning issues.
  const footerLines: string[] = [];
  if (result.reportUrl) {
    footerLines.push(
      `**Next:** Open ${result.reportUrl} to triage (approve / edit / dismiss) and push approved issues to Asana.`,
    );
  }
  if (totalIssues > 0) {
    footerLines.push(
      `_If your chat has the Asana MCP connected, you can ask it to create tasks directly from the findings above — each issue's title, principle, description, and acceptance criteria map 1-to-1 onto a ticket._`,
    );
  }
  const footer = footerLines.length > 0 ? `\n\n${footerLines.join("\n\n")}` : "";

  return `${summary}\n\n${lines.join("\n")}${footer}`;
}
