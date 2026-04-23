/**
 * Regression runner for the UX audit agent evals harness.
 *
 * For each golden case under evals/golden/*:
 *   1. Serve evals/golden (or the case's directory) via a tiny local static
 *      HTTP server — we prefer http:// over file:// so the crawler, viewport
 *      sizing, and axe-core run on exactly the same codepath as production.
 *   2. Screenshot all 3 viewports via the shared crawler.
 *   3. Analyze screenshots via the shared analyzer (same module the /api/audit
 *      route uses — fixing one fixes both).
 *   4. Flatten issues across all screenshots and score against expected.json
 *      using evals/matcher.ts.
 *
 * Aggregate results are written to evals/results.json. If evals/baseline.json
 * exists and has a passRate, we compare: a >5 pct-point drop exits nonzero
 * so CI can gate regressions.
 *
 * Usage:   npm run evals
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { fileURLToPath } from "node:url";

import { crawlAndScreenshot } from "../src/lib/crawler";
import { validateAnalysisResult, type UXIssue } from "../src/lib/analyzer";
import { analyzeScreenshotsDir } from "../src/lib/analyzer/run";
import { scoreCase, type CaseResult, type ExpectedCase } from "./matcher";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(EVALS_DIR, "golden");
const RESULTS_PATH = path.join(EVALS_DIR, "results.json");
const BASELINE_PATH = path.join(EVALS_DIR, "baseline.json");
const REGRESSION_THRESHOLD_PCT = 5; // pass-rate drop >5pp = regression

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

// ---------------------------------------------------------------------------
// Static server — serves evals/golden at http://127.0.0.1:<port>/<case>/
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function startStaticServer(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const rawPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
        // Default to /index.html for directory roots
        let relPath = rawPath === "/" ? "/index.html" : rawPath;
        if (relPath.endsWith("/")) relPath = relPath + "index.html";

        // Prevent path traversal — resolve and ensure it's inside root.
        const abs = path.normalize(path.join(root, relPath));
        if (!abs.startsWith(path.normalize(root))) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const ext = path.extname(abs).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
        fs.createReadStream(abs).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end((err as Error).message);
      }
    });

    server.on("error", reject);
    // Port 0 — OS assigns a free port so concurrent runs don't collide.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Static server failed to bind"));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        url,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Case discovery
// ---------------------------------------------------------------------------

interface GoldenCase {
  name: string;
  dir: string;
  expected: ExpectedCase;
  /** HTTP path served by the static server, e.g. "/contrast-fail/". */
  servePath: string;
}

function discoverCases(): GoldenCase[] {
  if (!fs.existsSync(GOLDEN_DIR)) {
    throw new Error(`Golden directory not found: ${GOLDEN_DIR}`);
  }
  const entries = fs.readdirSync(GOLDEN_DIR, { withFileTypes: true });
  const cases: GoldenCase[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(GOLDEN_DIR, e.name);
    const expectedPath = path.join(dir, "expected.json");
    const htmlPath = path.join(dir, "index.html");
    if (!fs.existsSync(expectedPath) || !fs.existsSync(htmlPath)) {
      console.warn(`${YELLOW}skipping ${e.name} — missing expected.json or index.html${RESET}`);
      continue;
    }
    const expected: ExpectedCase = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
    cases.push({
      name: e.name,
      dir,
      expected,
      servePath: `/${e.name}/`,
    });
  }
  cases.sort((a, b) => a.name.localeCompare(b.name));
  return cases;
}

// ---------------------------------------------------------------------------
// Per-case pipeline — crawl + analyze + score
// ---------------------------------------------------------------------------

interface CaseRun {
  name: string;
  passed: boolean;
  matchedCount: number;
  expectedCount: number;
  missing: ExpectedCase["must_match"];
  falsePositives: CaseResult["falsePositives"];
  totalFindings: number;
  durationMs: number;
  error?: string;
}

async function runCase(c: GoldenCase, baseUrl: string): Promise<CaseRun> {
  const start = Date.now();
  const url = `${baseUrl}${c.servePath}`;
  const outputDir = path.join(os.tmpdir(), `ux-evals-${c.name}-${Date.now()}`);
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    // Crawl — single-page eval (max 1 route). Skip axe to keep the run fast
    // and isolate the LLM analyzer as the thing under test.
    const outcome = await crawlAndScreenshot(url, outputDir, undefined, false, {
      maxRoutes: 1,
      skipAxe: true,
    });

    if (!("manifest" in outcome)) {
      throw new Error("Crawler returned unexpected outcome (auth/SSO on a local fixture?)");
    }

    // Analyze all screenshots in the output dir.
    const analyzed = await analyzeScreenshotsDir(outputDir, {
      label: `eval-${c.name}`,
    });

    // Flatten + validate issues across screenshots.
    const findings: UXIssue[] = [];
    for (const data of Object.values(analyzed.screenshots)) {
      try {
        const { issues } = validateAnalysisResult(data);
        findings.push(...issues);
      } catch {
        // Tolerate bad-shape screenshot results — they simply don't contribute
        // findings. The analyzer-schema test is owned by the smoke test.
      }
    }

    const score = scoreCase(findings, c.expected);
    const duration = Date.now() - start;

    return {
      name: c.name,
      passed: score.passed,
      matchedCount: score.matched.length,
      expectedCount: c.expected.must_match.length,
      missing: score.missing,
      falsePositives: score.falsePositives,
      totalFindings: findings.length,
      durationMs: duration,
    };
  } catch (err) {
    return {
      name: c.name,
      passed: false,
      matchedCount: 0,
      expectedCount: c.expected.must_match.length,
      missing: c.expected.must_match,
      falsePositives: [],
      totalFindings: 0,
      durationMs: Date.now() - start,
      error: (err as Error).message,
    };
  } finally {
    // Best-effort cleanup of per-case screenshot dir.
    try {
      fs.rmSync(outputDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Baseline comparison
// ---------------------------------------------------------------------------

interface Baseline {
  generatedAt: string | null;
  passRate: number | null;
  cases: Array<{ name: string; passed: boolean }>;
}

function loadBaseline(): Baseline | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    if (typeof baseline.passRate !== "number") return null; // empty placeholder
    return baseline;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`${CYAN}UX Audit Agent — evals harness${RESET}`);
  console.log(`${DIM}Golden dir: ${GOLDEN_DIR}${RESET}`);

  const cases = discoverCases();
  if (cases.length === 0) {
    console.error(`${RED}No golden cases found under ${GOLDEN_DIR}${RESET}`);
    process.exit(1);
  }
  console.log(`${DIM}Discovered ${cases.length} case(s): ${cases.map((c) => c.name).join(", ")}${RESET}\n`);

  const server = await startStaticServer(GOLDEN_DIR);
  console.log(`${DIM}Static server: ${server.url}${RESET}\n`);

  const runs: CaseRun[] = [];
  try {
    for (const c of cases) {
      process.stdout.write(`${CYAN}▶${RESET}  ${c.name} ... `);
      const run = await runCase(c, server.url);
      runs.push(run);
      const icon = run.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      process.stdout.write(`${icon} ${DIM}(${run.durationMs}ms)${RESET}\n`);
      if (run.error) {
        console.log(`   ${RED}error:${RESET} ${run.error}`);
      }
      console.log(
        `   ${DIM}findings: ${run.totalFindings}  matched: ${run.matchedCount}/${run.expectedCount}${RESET}`,
      );
      for (const miss of run.missing) {
        console.log(
          `   ${YELLOW}missing:${RESET} ${DIM}(cat=${miss.category ?? "*"}, min=${miss.min_severity ?? "minor"}) keywords=[${miss.keyword_any.join(", ")}]${RESET}`,
        );
      }
      for (const fp of run.falsePositives) {
        console.log(
          `   ${YELLOW}false-positive:${RESET} ${DIM}"${fp.finding.title}" matched banned keywords [${fp.rule.keyword_any.join(", ")}]${RESET}`,
        );
      }
    }
  } finally {
    await server.close();
  }

  // Aggregate
  const total = runs.length;
  const passed = runs.filter((r) => r.passed).length;
  const passRate = total === 0 ? 0 : passed / total;
  const passPct = (passRate * 100).toFixed(1);

  console.log("");
  console.log(`${DIM}─────────────────────────────────────────────${RESET}`);
  console.log(
    `Evals summary — ${passed}/${total} passed (${passPct}%) in ${runs.reduce((s, r) => s + r.durationMs, 0)}ms`,
  );
  console.log(`${DIM}─────────────────────────────────────────────${RESET}`);

  // Write results.json
  const resultsPayload = {
    generatedAt: new Date().toISOString(),
    passRate,
    total,
    passed,
    cases: runs.map((r) => ({
      name: r.name,
      passed: r.passed,
      matchedCount: r.matchedCount,
      expectedCount: r.expectedCount,
      totalFindings: r.totalFindings,
      durationMs: r.durationMs,
      missing: r.missing,
      falsePositives: r.falsePositives.map((fp) => ({
        finding: { id: fp.finding.id, title: fp.finding.title },
        rule: fp.rule,
      })),
      error: r.error,
    })),
  };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(resultsPayload, null, 2));
  console.log(`${DIM}Results written to ${RESULTS_PATH}${RESET}`);

  // Baseline comparison
  const baseline = loadBaseline();
  let regression = false;
  if (baseline && typeof baseline.passRate === "number") {
    const dropPct = (baseline.passRate - passRate) * 100;
    console.log(
      `${DIM}Baseline pass rate: ${(baseline.passRate * 100).toFixed(1)}%  —  Δ ${dropPct >= 0 ? "-" : "+"}${Math.abs(dropPct).toFixed(1)}pp${RESET}`,
    );
    if (dropPct > REGRESSION_THRESHOLD_PCT) {
      regression = true;
      console.log(
        `${RED}REGRESSION — pass rate dropped by more than ${REGRESSION_THRESHOLD_PCT}pp vs baseline.${RESET}`,
      );
    }
  } else {
    console.log(
      `${YELLOW}No baseline recorded. Inspect results.json and run:${RESET}\n  ${DIM}cp evals/results.json evals/baseline.json${RESET}`,
    );
  }

  // Exit code — nonzero on regression only. Individual case failures on a
  // fresh baseline shouldn't block CI until a baseline is locked in.
  if (regression) process.exit(1);
  // If no baseline, still exit 0 so the user can lock in the first run.
  // Once baseline is set, a pass-rate drop fails. A full run with 0 passes
  // and no baseline is almost certainly an infra failure — exit nonzero.
  if (!baseline && passed === 0) {
    console.log(`${RED}All cases failed and no baseline is set — likely an infra issue.${RESET}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`${RED}Evals runner crashed:${RESET}`, err);
  process.exit(1);
});
