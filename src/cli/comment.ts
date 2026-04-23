#!/usr/bin/env node
/**
 * PR-comment markdown formatter.
 *
 * Reads a findings JSON produced by `src/cli/audit.ts` and emits a sticky
 * PR-comment body to stdout. The GitHub Action pipes this into
 * `marocchino/sticky-pull-request-comment` so we upsert instead of spamming
 * on every push.
 *
 * Output format:
 *  1. `## UX audit` header + counts
 *  2. Optional "+N new critical" delta badge (when --base-findings is passed)
 *  3. Severity-sorted table — critical → major → minor, top 20
 *  4. "+N more" footer when truncated
 *  5. Hidden marker line so future runs can recognize/replace the comment
 *
 * Usage:
 *   tsx src/cli/comment.ts --findings findings.json --pr 42 --repo owner/name
 *   tsx src/cli/comment.ts --findings findings.json --pr 42 --repo owner/name --base-findings base.json
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { UXIssue } from "../lib/analyzer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matches the `header: ux-audit-agent` in the workflow — update both if changed. */
const COMMENT_MARKER = "<!-- ux-audit-agent:v1 -->";
const MAX_ROWS = 20;
const FIX_TRUNCATE_CHARS = 140;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditReport {
  url: string;
  timestamp: string;
  findings: UXIssue[];
  summary: {
    critical: number;
    major: number;
    minor: number;
  };
}

interface CliArgs {
  findings: string;
  pr: string;
  repo: string;
  baseFindings?: string;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--findings":
        args.findings = value;
        i++;
        break;
      case "--pr":
        args.pr = value;
        i++;
        break;
      case "--repo":
        args.repo = value;
        i++;
        break;
      case "--base-findings":
        args.baseFindings = value;
        i++;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        if (flag.startsWith("--")) {
          throw new Error(`Unknown flag: ${flag}`);
        }
    }
  }
  if (!args.findings) throw new Error("Missing required flag: --findings");
  if (!args.pr) throw new Error("Missing required flag: --pr");
  if (!args.repo) throw new Error("Missing required flag: --repo");
  return args as CliArgs;
}

function printUsage(): void {
  process.stdout.write(
    [
      "ux-audit comment formatter",
      "",
      "Usage: tsx src/cli/comment.ts --findings <path> --pr <num> --repo <owner/name> [--base-findings <path>]",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Severity rank — higher index == worse. Used to sort and diff. */
const SEVERITY_RANK: Record<UXIssue["severity"], number> = {
  critical: 3,
  major: 2,
  minor: 1,
};

/** Emoji badge prefix for readability in GitHub's monospace table. */
const SEVERITY_BADGE: Record<UXIssue["severity"], string> = {
  critical: "`CRITICAL`",
  major: "`MAJOR`",
  minor: "`MINOR`",
};

function loadReport(p: string): AuditReport {
  const resolved = path.resolve(p);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Findings file not found: ${resolved}`);
  }
  const data = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  if (!data || !Array.isArray(data.findings)) {
    throw new Error(`Invalid findings file: ${resolved} — expected { findings: [...] }`);
  }
  return data as AuditReport;
}

/** Escape `|`, backticks, and newlines so table cells render correctly. */
function escapeCell(s: string): string {
  return s
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .trim();
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function sortBySeverity(findings: UXIssue[]): UXIssue[] {
  return [...findings].sort((a, b) => {
    const diff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (diff !== 0) return diff;
    // Stable secondary sort by title for deterministic output — PRs with the
    // same issues across runs should produce identical comment bodies.
    return a.title.localeCompare(b.title);
  });
}

/**
 * Derive a short viewport label for the table.
 * If an issue affects all three viewports we show "all"; otherwise the
 * comma-separated list. Keeps the column narrow.
 */
function viewportLabel(vps: UXIssue["affected_viewports"]): string {
  if (vps.length === 3) return "all";
  return vps.join(", ");
}

function selectorLabel(f: UXIssue): string {
  // Prefer the axe/selector field when present, else the LLM's prose label.
  const raw = f.element_selector || f.affected_element || "";
  return truncate(raw, 60);
}

/**
 * Build a delta map of new findings by severity, given the current and base
 * reports. We identify issues by id; the analyzer currently produces stable
 * ids per (file, issue) but not across runs — so this is a best-effort
 * approximation. A finding counts as "new" if its id isn't in the base set.
 */
function computeDelta(current: UXIssue[], base: UXIssue[]): {
  critical: number;
  major: number;
  minor: number;
  total: number;
} {
  const baseIds = new Set(base.map((f) => f.id));
  const added = current.filter((f) => !baseIds.has(f.id));
  return {
    critical: added.filter((f) => f.severity === "critical").length,
    major: added.filter((f) => f.severity === "major").length,
    minor: added.filter((f) => f.severity === "minor").length,
    total: added.length,
  };
}

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------

function buildMarkdown(
  report: AuditReport,
  args: CliArgs,
  baseReport?: AuditReport,
): string {
  const { findings, summary, url } = report;
  const sorted = sortBySeverity(findings);
  const visible = sorted.slice(0, MAX_ROWS);
  const hidden = sorted.length - visible.length;

  const lines: string[] = [];
  lines.push(`## UX audit`);
  lines.push("");
  lines.push(
    `Audited [\`${url}\`](${url}) for [#${args.pr}](https://github.com/${args.repo}/pull/${args.pr}) — ` +
      `**${summary.critical}** critical, **${summary.major}** major, **${summary.minor}** minor.`,
  );

  // --- Delta badge (if base provided) ----------------------------------
  if (baseReport) {
    const delta = computeDelta(findings, baseReport.findings);
    if (delta.total > 0) {
      const parts: string[] = [];
      if (delta.critical > 0) parts.push(`+${delta.critical} new critical`);
      if (delta.major > 0) parts.push(`+${delta.major} new major`);
      if (delta.minor > 0) parts.push(`+${delta.minor} new minor`);
      lines.push("");
      lines.push(`> :rotating_light: ${parts.join(", ")} vs. base branch.`);
    } else {
      lines.push("");
      lines.push(`> :white_check_mark: No new issues vs. base branch.`);
    }
  }

  lines.push("");

  if (findings.length === 0) {
    lines.push(`:tada: No UX issues found.`);
    lines.push("");
    lines.push(COMMENT_MARKER);
    return lines.join("\n");
  }

  // --- Findings table ---------------------------------------------------
  lines.push("| Severity | Principle | Title | Viewport | Selector | Suggested fix |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const f of visible) {
    lines.push(
      "| " +
        [
          SEVERITY_BADGE[f.severity],
          escapeCell(f.principle),
          escapeCell(f.title),
          escapeCell(viewportLabel(f.affected_viewports)),
          escapeCell(selectorLabel(f)),
          escapeCell(truncate(f.suggested_fix, FIX_TRUNCATE_CHARS)),
        ].join(" | ") +
        " |",
    );
  }

  if (hidden > 0) {
    lines.push("");
    lines.push(`_+${hidden} more finding(s) — see the \`findings.json\` artifact attached to this run._`);
  }

  lines.push("");
  lines.push("<sub>Generated by [ux-audit-agent](https://github.com/NaimGQKC/ux-audit-agent).</sub>");
  lines.push("");
  lines.push(COMMENT_MARKER);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const report = loadReport(args.findings);
  const baseReport = args.baseFindings ? loadReport(args.baseFindings) : undefined;
  const md = buildMarkdown(report, args, baseReport);
  process.stdout.write(md);
  // Trailing newline so `> comment.md` files have POSIX-compliant endings.
  if (!md.endsWith("\n")) process.stdout.write("\n");
}

try {
  main();
} catch (err) {
  process.stderr.write(`\nFATAL: ${(err as Error).message}\n`);
  process.exit(1);
}
