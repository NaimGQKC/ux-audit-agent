#!/usr/bin/env node
/**
 * Headless UX audit CLI.
 *
 * Runs the same crawl + analyze pipeline as `POST /api/audit` but as a
 * standalone Node process — no Next.js server required. Intended for use
 * from CI (e.g. the `.github/workflows/ux-audit.yml` GitHub Action) where
 * we want to audit a PR preview URL and fail the build on critical issues.
 *
 * Usage:
 *   tsx src/cli/audit.ts --url https://example.com --out findings.json [--fail-on critical]
 *
 * Design notes:
 *  - Imports the crawler + analyzer libs directly; never starts Next.js.
 *  - Flattens the per-page / per-viewport analysis tree into a single
 *    `findings[]` array so downstream consumers (comment.ts, PR badges)
 *    don't need to know about viewports.
 *  - Writes the JSON report BEFORE throwing on threshold breach, so the
 *    PR comment still posts even when the audit step fails.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  crawlAndScreenshot,
  VIEWPORTS,
  type CrawlResult,
  type ViewportName,
} from "../lib/crawler";
import {
  validateAnalysisResult,
  type UXIssue,
} from "../lib/analyzer";
import { analyzeScreenshotsDir } from "../lib/analyzer/run";
import { checkClaudeHealth } from "../lib/claude";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FailLevel = "critical" | "major" | "minor" | "none";

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
  url: string;
  out: string;
  failOn: FailLevel;
}

// ---------------------------------------------------------------------------
// Arg parsing — deliberately minimal to avoid a dep on commander/yargs
// ---------------------------------------------------------------------------

const VALID_FAIL_LEVELS = new Set<FailLevel>(["critical", "major", "minor", "none"]);

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = { failOn: "none" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--url":
        args.url = value;
        i++;
        break;
      case "--out":
        args.out = value;
        i++;
        break;
      case "--fail-on":
        if (!VALID_FAIL_LEVELS.has(value as FailLevel)) {
          throw new Error(
            `Invalid --fail-on value "${value}". Expected one of: critical, major, minor, none`,
          );
        }
        args.failOn = value as FailLevel;
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

  if (!args.url) throw new Error("Missing required flag: --url");
  if (!args.out) throw new Error("Missing required flag: --out");

  return args as CliArgs;
}

function printUsage(): void {
  process.stdout.write(
    [
      "ux-audit — headless UX audit runner",
      "",
      "Usage: tsx src/cli/audit.ts --url <url> --out <path> [--fail-on <level>]",
      "",
      "Options:",
      "  --url       URL of the site to audit (required)",
      "  --out       Path to write the JSON report (required)",
      "  --fail-on   Severity threshold for nonzero exit: critical|major|minor|none (default: none)",
      "  -h, --help  Show this help message",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

/** Severity ordering — higher index == worse. */
const SEVERITY_RANK: Record<UXIssue["severity"], number> = {
  minor: 0,
  major: 1,
  critical: 2,
};

/** Numeric rank for a fail-on level; "none" is +Infinity so it never trips. */
function failLevelRank(level: FailLevel): number {
  if (level === "none") return Number.POSITIVE_INFINITY;
  return SEVERITY_RANK[level];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Surface a clean error if the Claude CLI isn't installed on the runner.
  // The analyzer will throw a confusing ENOENT otherwise.
  log("Checking Claude CLI availability...");
  const health = await checkClaudeHealth();
  if (!health.ok) {
    process.stderr.write(
      `\nERROR: Claude CLI is not available.\n` +
        `  Install it from https://docs.claude.com/claude-code and authenticate with 'claude login'.\n` +
        `  Underlying error: ${health.error}\n`,
    );
    process.exit(2);
  }

  // --- Crawl & screenshot -------------------------------------------------
  const outputDir = path.join(
    os.tmpdir(),
    `ux-audit-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  log(`Crawling ${args.url}...`);
  const outcome = await crawlAndScreenshot(args.url, outputDir, undefined, false, {
    // Axe + Lighthouse are skipped in CI — the audit route runs them via
    // the dashboard flow but they slow down PR feedback and double the
    // runner's system-deps footprint. LLM-only gives us the fast path.
    skipAxe: true,
  });

  if ("needsAuth" in outcome && outcome.needsAuth) {
    process.stderr.write(
      `\nERROR: Site requires authentication (${outcome.authUrl}).\n` +
        `  The CLI does not support interactive login — run the audit dashboard instead.\n`,
    );
    process.exit(3);
  }
  if ("needsSSOLogin" in outcome && outcome.needsSSOLogin) {
    process.stderr.write(
      `\nERROR: Site redirected to SSO (${outcome.redirectUrl}).\n` +
        `  The CLI does not support SSO flows — run the audit dashboard instead.\n`,
    );
    process.exit(3);
  }

  const manifest = (outcome as CrawlResult).manifest;
  log(`Captured ${manifest.routes.length} route(s). Analyzing...`);

  // --- Analyze ------------------------------------------------------------
  // We use analyzeScreenshotsDir (directory-level, batched) instead of the
  // per-page pipeline from the route: CI doesn't need progressive output,
  // and the directory-level runner is faster for batch sizes > 1 page.
  const analysis = await analyzeScreenshotsDir(outputDir, {
    batchSize: 3,
    concurrency: 3,
    label: "audit-cli",
    onProgress: (msg, current, total) => log(`  [${current + 1}/${total}] ${msg}`),
  });

  if (analysis.failedBatches > 0) {
    log(
      `Warning: ${analysis.failedBatches}/${analysis.totalBatches} batch(es) failed. ` +
        `Report will be partial. First failure: ${analysis.errors[0]?.reason}`,
    );
  }

  // --- Flatten per-route / per-viewport findings -------------------------
  const viewportNames = Object.keys(VIEWPORTS) as ViewportName[];
  const findings: UXIssue[] = [];
  for (const route of manifest.routes) {
    for (const vp of viewportNames) {
      const filename = route.screenshots[vp];
      if (!filename) continue;
      const raw = analysis.screenshots[filename];
      if (!raw) continue;
      try {
        const { issues } = validateAnalysisResult(raw);
        findings.push(...issues);
      } catch (err) {
        log(`Warning: validation failed for ${filename}: ${(err as Error).message}`);
      }
    }
  }

  const summary = {
    critical: findings.filter((f) => f.severity === "critical").length,
    major: findings.filter((f) => f.severity === "major").length,
    minor: findings.filter((f) => f.severity === "minor").length,
  };

  const report: AuditReport = {
    url: args.url,
    timestamp: manifest.timestamp,
    findings,
    summary,
  };

  // --- Write report (always, even before throwing on threshold) ---------
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  log(
    `\nReport written to ${outPath} — ` +
      `${findings.length} finding(s): ` +
      `${summary.critical} critical, ${summary.major} major, ${summary.minor} minor`,
  );

  // --- Threshold check ---------------------------------------------------
  const threshold = failLevelRank(args.failOn);
  const worstFound = findings.reduce<number>(
    (worst, f) => Math.max(worst, SEVERITY_RANK[f.severity]),
    -1,
  );
  if (worstFound >= threshold) {
    process.stderr.write(
      `\nAudit failed: found findings at or above --fail-on=${args.failOn}.\n`,
    );
    process.exit(1);
  }
}

function log(msg: string): void {
  // Use stderr so stdout stays reserved for any future `--json` streaming mode.
  process.stderr.write(`${msg}\n`);
}

main().catch((err) => {
  process.stderr.write(`\nFATAL: ${(err as Error).message}\n`);
  process.exit(2);
});
