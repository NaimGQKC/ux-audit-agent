/**
 * End-to-end smoke test for the UX audit agent.
 *
 * Exercises every critical pipeline against a real URL:
 *   1. Pre-flight       — env vars, claude CLI, playwright browsers
 *   2. Crawl            — Playwright screenshots at 3 viewports
 *   3. Analyze          — Claude Vision via analyze.sh
 *   4. Validate schema  — analyzer's validateAnalysisResult on every screenshot
 *   5. Asana push       — create 1 task in ASANA_PROJECT_ID, then delete it
 *   6. Export report    — invoke /api/export-report POST handler, write HTML to disk
 *
 * Usage:
 *   npm run smoke                          # defaults to https://example.com
 *   npm run smoke -- https://your-url      # any URL
 *   npm run smoke -- --skip-asana          # skip the Asana stage
 *   npm run smoke -- --skip-export         # skip the export stage
 *
 * Exits with code 0 on full pass, 1 on any failure.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { crawlAndScreenshot } from "../src/lib/crawler";
import { validateAnalysisResult } from "../src/lib/analyzer";
import { analyzeScreenshotsDir } from "../src/lib/analyzer/run";
import { createTicket, type UXIssue as AsanaUXIssue } from "../src/lib/asana";

// ---------------------------------------------------------------------------
// .env.local loader (zero-dep)
// ---------------------------------------------------------------------------

function loadEnvLocal(): void {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Tiny logger / stage runner
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

interface StageResult {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
}

const results: StageResult[] = [];

async function stage<T>(
  name: string,
  fn: () => Promise<T> | T
): Promise<T | undefined> {
  const start = Date.now();
  process.stdout.write(`${CYAN}▶${RESET}  ${name} ... `);
  try {
    const value = await fn();
    const ms = Date.now() - start;
    results.push({ name, ok: true, ms });
    process.stdout.write(`${GREEN}✓${RESET} ${DIM}(${ms}ms)${RESET}\n`);
    return value;
  } catch (err) {
    const ms = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, ms, error });
    process.stdout.write(`${RED}✗${RESET} ${DIM}(${ms}ms)${RESET}\n`);
    process.stdout.write(`   ${RED}${error}${RESET}\n`);
    return undefined;
  }
}

function printSummary(): boolean {
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`${DIM}─────────────────────────────────────────────${RESET}`);
  console.log(`Smoke test summary — ${results.length} stage(s)`);
  for (const r of results) {
    const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon}  ${r.name} ${DIM}(${r.ms}ms)${RESET}`);
  }
  console.log(`${DIM}─────────────────────────────────────────────${RESET}`);
  if (failed.length === 0) {
    console.log(`${GREEN}All stages passed.${RESET}`);
    return true;
  }
  console.log(`${RED}${failed.length} stage(s) failed.${RESET}`);
  return false;
}

// ---------------------------------------------------------------------------
// Stage implementations
// ---------------------------------------------------------------------------

interface Args {
  url: string;
  skipAsana: boolean;
  skipExport: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith("--"));
  return {
    url: positional[0] || "https://example.com",
    skipAsana: argv.includes("--skip-asana"),
    skipExport: argv.includes("--skip-export"),
  };
}

function preflight(args: Args): void {
  // Validate URL
  try {
    new URL(args.url);
  } catch {
    throw new Error(`Invalid URL: ${args.url}`);
  }

  // Claude CLI — shell:true lets PATHEXT resolve .exe / .cmd on Windows
  const claudeCheck = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    shell: true,
  });
  if (claudeCheck.status !== 0) {
    throw new Error(
      `claude CLI not available — exit ${claudeCheck.status}\n${claudeCheck.stderr || claudeCheck.stdout}`
    );
  }

  // Playwright browsers (chromium installed)
  // Quick check by importing playwright (already done at top — failure would have crashed)

  // Analyzer prompt file present
  const promptPath = path.resolve("src/lib/analyzer/ux-analysis-prompt.txt");
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Analyzer prompt not found at ${promptPath}`);
  }

  // analyze.sh present
  const analyzeShPath = path.resolve("analyze.sh");
  if (!fs.existsSync(analyzeShPath)) {
    throw new Error(`analyze.sh not found at ${analyzeShPath}`);
  }

  // Asana env (only if not skipping)
  if (!args.skipAsana) {
    if (!process.env.ASANA_ACCESS_TOKEN) {
      throw new Error("ASANA_ACCESS_TOKEN not set in .env.local");
    }
    if (!process.env.ASANA_PROJECT_ID) {
      throw new Error("ASANA_PROJECT_ID not set in .env.local");
    }
  }
}

interface CrawlOutput {
  outputDir: string;
  manifestPath: string;
  routes: number;
}

async function runCrawl(url: string): Promise<CrawlOutput> {
  // Use a unique tmp dir so smoke runs don't collide
  const outputDir = path.join(os.tmpdir(), `ux-smoke-${Date.now()}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const outcome = await crawlAndScreenshot(url, outputDir);

  if ("needsAuth" in outcome && outcome.needsAuth) {
    throw new Error(`Auth wall hit at ${outcome.authUrl} — pick a public URL for the smoke test`);
  }
  if ("needsSSOLogin" in outcome && outcome.needsSSOLogin) {
    throw new Error(`SSO redirect to ${outcome.redirectUrl} — pick a public URL`);
  }
  if (!("manifest" in outcome)) {
    throw new Error("Crawler returned an unexpected outcome");
  }

  const pngs = fs.readdirSync(outputDir).filter((f) => f.endsWith(".png"));
  if (pngs.length === 0) {
    throw new Error(`No screenshots written to ${outputDir}`);
  }

  return {
    outputDir,
    manifestPath: path.join(outputDir, "manifest.json"),
    routes: outcome.manifest.totalRoutes,
  };
}

interface AnalyzeOutput {
  resultsPath: string;
  totalIssues: number;
  byScreenshot: Record<string, number>;
  totalBatches: number;
  failedBatches: number;
  batchErrors: Array<{ batchIndex: number; reason: string }>;
}

async function runAnalyze(outputDir: string): Promise<AnalyzeOutput> {
  // Use the shared batched analyzer — same implementation the /api/audit
  // route uses, so smoke-test failures are real production failures.
  const result = await analyzeScreenshotsDir(outputDir, {
    onProgress: (msg, current, total) =>
      process.stdout.write(`\r   ${DIM}${msg} (${current + 1}/${total})${RESET}    `),
  });

  // Erase the progress line before returning so the next stage's status renders cleanly.
  process.stdout.write("\r" + " ".repeat(80) + "\r");

  // Persist to disk so downstream stages (export, manual inspection) can read it.
  const resultsPath = path.join(outputDir, "analysis-results.json");
  fs.writeFileSync(
    resultsPath,
    JSON.stringify({ screenshots: result.screenshots }, null, 2),
  );

  const byScreenshot: Record<string, number> = {};
  let total = 0;
  for (const [filename, data] of Object.entries(result.screenshots)) {
    const count = data?.issues?.length ?? 0;
    byScreenshot[filename] = count;
    total += count;
  }

  return {
    resultsPath,
    totalIssues: total,
    byScreenshot,
    totalBatches: result.totalBatches,
    failedBatches: result.failedBatches,
    batchErrors: result.errors,
  };
}

function runValidate(resultsPath: string): { validated: number } {
  const parsed: { screenshots: Record<string, { issues: unknown[] }> } = JSON.parse(
    fs.readFileSync(resultsPath, "utf8")
  );

  let validated = 0;
  for (const [filename, data] of Object.entries(parsed.screenshots)) {
    try {
      validateAnalysisResult(data);
      validated++;
    } catch (err) {
      throw new Error(`${filename}: ${(err as Error).message}`);
    }
  }
  return { validated };
}

interface AsanaStageOutput {
  taskGid: string;
  taskUrl: string;
  cleanedUp: boolean;
}

async function runAsana(resultsPath: string): Promise<AsanaStageOutput> {
  // Pick the first issue from any screenshot that has one — many screenshots
  // come back with empty issues[] when Claude finds nothing to flag.
  const parsed: {
    screenshots: Record<
      string,
      { issues: Array<Record<string, unknown>> }
    >;
  } = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

  let firstIssue: Record<string, unknown> | undefined;
  for (const data of Object.values(parsed.screenshots)) {
    if (data?.issues?.length) {
      firstIssue = data.issues[0];
      break;
    }
  }
  if (!firstIssue) {
    throw new Error("No issues found across any screenshot — nothing to push");
  }

  const stamp = new Date().toISOString();
  const issue: AsanaUXIssue = {
    title: `[SMOKE TEST ${stamp}] ${String(firstIssue.title)}`,
    description: String(firstIssue.description),
    severity: firstIssue.severity as AsanaUXIssue["severity"],
    category: String(firstIssue.category),
    principle: firstIssue.principle ? String(firstIssue.principle) : undefined,
    affected_element: String(firstIssue.affected_element),
    steps_to_reproduce: String(firstIssue.steps_to_reproduce),
    suggested_fix: String(firstIssue.suggested_fix),
    acceptance_criteria: String(firstIssue.acceptance_criteria),
    affected_viewports: (firstIssue.affected_viewports as AsanaUXIssue["affected_viewports"]) ?? [
      "desktop",
    ],
    recommendation: String(firstIssue.recommendation),
  };

  const created = await createTicket(issue);

  // Cleanup — delete the task we just created
  let cleanedUp = false;
  const deleteRes = await fetch(`https://app.asana.com/api/1.0/tasks/${created.gid}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
    },
  });
  if (deleteRes.ok) {
    cleanedUp = true;
  } else {
    // Don't fail the stage on cleanup — the create succeeded which is the smoke signal.
    // But surface it loudly so the user can clean up manually.
    console.warn(
      `${YELLOW}   ⚠ Asana cleanup failed (HTTP ${deleteRes.status}). Delete task ${created.gid} manually.${RESET}`
    );
  }

  return { taskGid: created.gid, taskUrl: created.url, cleanedUp };
}

interface ExportOutput {
  htmlPath: string;
  bytes: number;
}

async function runExport(args: {
  url: string;
  outputDir: string;
  manifestPath: string;
  resultsPath: string;
}): Promise<ExportOutput> {
  // Lazy import so the route's next/server deps don't crash earlier stages
  const { POST } = await import("../src/app/api/export-report/route");

  // Read the analysis results and crawl manifest, build the request shape the route expects
  interface Manifest {
    routes: Array<{
      route: string;
      url: string;
      screenshots: Record<string, string>;
    }>;
    sessionId: string;
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(args.manifestPath, "utf8"));
  const analysis: {
    screenshots: Record<string, { issues: Array<Record<string, unknown>> }>;
  } = JSON.parse(fs.readFileSync(args.resultsPath, "utf8"));

  // Copy screenshots to the export route's expected location: os.tmpdir()/<sessionId>/<filename>
  // The route resolves /api/screenshot?s=<sessionId>&f=<filename> back to that path.
  // For the smoke test, we use the actual outputDir basename as sessionId so the route can find them.
  const sessionId = path.basename(args.outputDir);
  const expectedDir = path.join(os.tmpdir(), sessionId);
  if (!fs.existsSync(expectedDir)) {
    fs.mkdirSync(expectedDir, { recursive: true });
  }
  // outputDir already lives under os.tmpdir() with the same basename, so the path is identical.
  // (See runCrawl: outputDir = path.join(os.tmpdir(), `ux-smoke-${Date.now()}`))

  const pages = manifest.routes.map((route) => {
    const screenshots: Record<string, string> = {};
    for (const [vp, filename] of Object.entries(route.screenshots)) {
      screenshots[vp] = `/api/screenshot?s=${sessionId}&f=${filename}`;
    }
    // Find issues for this route by matching screenshot filenames
    const issues: Array<Record<string, unknown>> = [];
    for (const filename of Object.values(route.screenshots)) {
      const data = analysis.screenshots[filename];
      if (data?.issues) {
        for (const i of data.issues) {
          issues.push({ ...i, status: "pending" });
        }
      }
    }
    return {
      url: route.url,
      title: route.route,
      screenshots,
      issues,
    };
  });

  const payload = { auditUrl: args.url, pages };
  const req = new Request("http://localhost/api/export-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // The route expects NextRequest but is structurally compatible with Request
  const res = await POST(req as unknown as Parameters<typeof POST>[0]);
  if (!res.ok) {
    throw new Error(`export-report returned HTTP ${res.status}: ${await res.text()}`);
  }
  const html = await res.text();
  if (!html.includes("<html") || !html.includes("UX Audit Report")) {
    throw new Error("export-report HTML doesn't look right (missing <html> or title)");
  }

  const htmlPath = path.join(args.outputDir, "smoke-report.html");
  fs.writeFileSync(htmlPath, html);
  return { htmlPath, bytes: html.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnvLocal();
  const args = parseArgs();

  console.log(`${CYAN}UX Audit Agent — smoke test${RESET}`);
  console.log(`${DIM}Target URL: ${args.url}${RESET}`);
  if (args.skipAsana) console.log(`${DIM}Skipping: Asana${RESET}`);
  if (args.skipExport) console.log(`${DIM}Skipping: Export${RESET}`);
  console.log("");

  // Stage 1
  await stage("Pre-flight checks", () => preflight(args));

  // Stage 2
  const crawl = await stage(`Crawl ${args.url}`, () => runCrawl(args.url));
  if (!crawl) return finish();
  console.log(`   ${DIM}↳ ${crawl.routes} route(s), screenshots in ${crawl.outputDir}${RESET}`);

  // Stage 3
  const analyze = await stage("Analyze screenshots (Claude Vision)", () =>
    runAnalyze(crawl.outputDir)
  );
  if (!analyze) return finish();
  const batchInfo =
    analyze.totalBatches > 1
      ? ` in ${analyze.totalBatches} batches${analyze.failedBatches > 0 ? ` (${analyze.failedBatches} failed)` : ""}`
      : "";
  console.log(
    `   ${DIM}↳ ${analyze.totalIssues} issue(s) across ${Object.keys(analyze.byScreenshot).length} screenshot(s)${batchInfo}${RESET}`
  );
  // Surface batch failure reasons so we can diagnose flakes (truncated JSON,
  // CLI timeouts, prompt-too-long, etc.) without re-running the whole audit.
  for (const e of analyze.batchErrors) {
    console.log(
      `   ${YELLOW}⚠ batch ${e.batchIndex + 1} failed:${RESET} ${DIM}${e.reason.split("\n")[0].slice(0, 200)}${RESET}`
    );
  }

  if (analyze.totalIssues === 0) {
    console.log(
      `${YELLOW}   ⚠ analyzer returned zero issues — downstream stages have nothing to push${RESET}`
    );
  }

  // Stage 4
  const validation = await stage("Validate analyzer schema", () =>
    runValidate(analyze.resultsPath)
  );
  if (!validation) return finish();
  console.log(`   ${DIM}↳ ${validation.validated} screenshot result(s) valid${RESET}`);

  // Stage 5
  if (!args.skipAsana && analyze.totalIssues > 0) {
    const asana = await stage("Asana — push 1 ticket + cleanup", () =>
      runAsana(analyze.resultsPath)
    );
    if (asana) {
      console.log(`   ${DIM}↳ task ${asana.taskGid} → ${asana.taskUrl}${RESET}`);
      console.log(
        `   ${DIM}↳ cleanup: ${asana.cleanedUp ? "deleted" : "FAILED — delete manually"}${RESET}`
      );
    }
  }

  // Stage 6
  if (!args.skipExport) {
    const exp = await stage("Export HTML report", () =>
      runExport({
        url: args.url,
        outputDir: crawl.outputDir,
        manifestPath: crawl.manifestPath,
        resultsPath: analyze.resultsPath,
      })
    );
    if (exp) {
      console.log(`   ${DIM}↳ ${(exp.bytes / 1024).toFixed(1)} KB → ${exp.htmlPath}${RESET}`);
    }
  }

  finish();
}

function finish(): never {
  const ok = printSummary();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`${RED}Smoke test crashed:${RESET}`, err);
  process.exit(1);
});
