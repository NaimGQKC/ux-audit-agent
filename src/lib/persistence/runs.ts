/**
 * Tiny filesystem-backed store for audit runs.
 *
 * Each run is written to `.audit-runs/<runId>.json` at the repo root.
 * The store is intentionally minimal: JSON-per-run, no locking, no migrations.
 * It is only consumed by the hosted report viewer (`/report/<runId>`) — the
 * audit pipeline will later call `saveRun` after a successful analysis.
 *
 * RunId validation: we only accept `[a-zA-Z0-9_-]{1,64}` to prevent path
 * traversal via `../` or absolute-path shenanigans.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { UXIssue } from "@/lib/analyzer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditReportSummary {
  critical: number;
  major: number;
  minor: number;
}

export interface AuditReport {
  runId: string;
  url: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  findings: UXIssue[];
  summary: AuditReportSummary;
}

export interface RunListEntry {
  runId: string;
  url: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const RUNS_DIR = path.join(process.cwd(), ".audit-runs");
const RUN_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    throw new Error(
      `Invalid runId: must match /^[a-zA-Z0-9_-]{1,64}$/ — got ${JSON.stringify(runId)}`,
    );
  }
}

async function ensureRunsDir(): Promise<string> {
  await fsp.mkdir(RUNS_DIR, { recursive: true });
  return RUNS_DIR;
}

function runPath(runId: string): string {
  return path.join(RUNS_DIR, `${runId}.json`);
}

/**
 * Compute the summary badge counts from a finding list.
 * Exported so callers that build an AuditReport don't have to duplicate
 * the logic — just pass `findings` and spread the result into `summary`.
 */
export function summarize(findings: UXIssue[]): AuditReportSummary {
  const summary: AuditReportSummary = { critical: 0, major: 0, minor: 0 };
  for (const f of findings) {
    if (f.severity === "critical") summary.critical += 1;
    else if (f.severity === "major") summary.major += 1;
    else if (f.severity === "minor") summary.minor += 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Persist an audit report. Overwrites any prior run with the same id.
 * The store creates the runs directory on first write.
 */
export async function saveRun(runId: string, report: AuditReport): Promise<void> {
  assertRunId(runId);
  await ensureRunsDir();

  // Normalise: the canonical runId for the file must match the payload.
  const normalised: AuditReport = { ...report, runId };
  const tmp = runPath(runId) + ".tmp";
  const final = runPath(runId);
  await fsp.writeFile(tmp, JSON.stringify(normalised, null, 2), "utf-8");
  await fsp.rename(tmp, final);
}

/**
 * Load a run by id. Returns `null` if the file is missing or malformed.
 * Callers should treat `null` as "not found" (the viewer renders a 404).
 */
export async function loadRun(runId: string): Promise<AuditReport | null> {
  if (!RUN_ID_RE.test(runId)) return null;

  const file = runPath(runId);
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuditReport>;
    if (
      typeof parsed !== "object" || parsed === null
      || typeof parsed.url !== "string"
      || typeof parsed.timestamp !== "string"
      || !Array.isArray(parsed.findings)
    ) {
      return null;
    }
    const findings = parsed.findings as UXIssue[];
    const summary = parsed.summary && typeof parsed.summary === "object"
      ? {
          critical: Number(parsed.summary.critical) || 0,
          major: Number(parsed.summary.major) || 0,
          minor: Number(parsed.summary.minor) || 0,
        }
      : summarize(findings);
    return {
      runId,
      url: parsed.url,
      timestamp: parsed.timestamp,
      findings,
      summary,
    };
  } catch {
    return null;
  }
}

/**
 * List all runs, newest first. Corrupt entries are silently skipped so a
 * single bad file can't take out the index page.
 */
export async function listRuns(): Promise<RunListEntry[]> {
  // Don't create the dir just to list it — if it doesn't exist, return [].
  if (!fs.existsSync(RUNS_DIR)) return [];

  const entries = await fsp.readdir(RUNS_DIR, { withFileTypes: true });
  const jsonFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".tmp.json"),
  );

  const out: RunListEntry[] = [];
  for (const entry of jsonFiles) {
    const runId = entry.name.replace(/\.json$/, "");
    if (!RUN_ID_RE.test(runId)) continue;

    try {
      const raw = await fsp.readFile(path.join(RUNS_DIR, entry.name), "utf-8");
      const parsed = JSON.parse(raw) as Partial<AuditReport>;
      if (typeof parsed.url === "string" && typeof parsed.timestamp === "string") {
        out.push({ runId, url: parsed.url, timestamp: parsed.timestamp });
      }
    } catch {
      // Skip corrupt files — listing should never throw.
    }
  }

  out.sort((a, b) => {
    const ta = Date.parse(a.timestamp) || 0;
    const tb = Date.parse(b.timestamp) || 0;
    return tb - ta;
  });
  return out;
}

/** Exposed for tests + route handlers that want to pre-validate input. */
export function isValidRunId(runId: string): boolean {
  return typeof runId === "string" && RUN_ID_RE.test(runId);
}
