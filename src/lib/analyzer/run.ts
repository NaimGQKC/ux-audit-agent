/**
 * Batched screenshot analyzer — single source of truth for both the audit
 * route and the standalone smoke-test / CLI flows.
 *
 * Why this exists:
 *  - Sending 30+ images to Claude in one call returns sparse / truncated
 *    results. Batching at ~6 images keeps each call focused and small.
 *  - Bounded-concurrency parallel execution turns sequential batches into
 *    a 3x-faster fan-out without overwhelming the Claude CLI.
 *  - Both the production route and the smoke test now consume this module
 *    so behavior stays consistent — fixing one fixes both.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { runClaudePrint } from "../claude";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AnalyzeOptions {
  /** Optional PRD context inlined at the top of the prompt. */
  prdContext?: string;
  /** Optional GitHub repo context inlined at the top of the prompt. */
  repoContext?: string;
  /** Screenshots per Claude call. Default: 6. */
  batchSize?: number;
  /** Max parallel Claude calls. Default: 3. */
  concurrency?: number;
  /** Progress callback fired before each batch. */
  onProgress?: (msg: string, current: number, total: number) => void;
}

export interface AnalyzeResult {
  /** Merged map of screenshot filename → { issues: [...] }. */
  screenshots: Record<string, { issues: unknown[] }>;
  totalBatches: number;
  failedBatches: number;
  /** Per-batch failures with reason — useful for surface-level diagnostics. */
  errors: Array<{ batchIndex: number; reason: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_CONCURRENCY = 3;
const PROMPT_FILE_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "analyzer",
  "ux-analysis-prompt.txt",
);

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(
  pngs: string[],
  basePrompt: string,
  prdContext?: string,
  repoContext?: string,
): string {
  let prompt = "";

  if (prdContext) {
    prompt += `PROJECT CONTEXT:\n${prdContext}\n\nUse the project context above to evaluate the UI against actual product requirements and goals. Flag issues where the implementation diverges from stated requirements. Reference PRD requirements in acceptance_criteria where applicable.\n\n---\n\n`;
  }

  if (repoContext) {
    prompt += `REPOSITORY CONTEXT:\nThe following files were extracted from the project's GitHub repository. Use them to understand the design system, tech stack, component patterns, and project conventions. Reference specific design tokens, component names, or config values in your recommendations where relevant.\n\n${repoContext}\n\n---\n\n`;
  }

  prompt += basePrompt;

  prompt += `\n\n---\n\nAnalyze each of the following screenshot image files for UX and accessibility issues. Read each file listed below, then evaluate it against all the criteria described above.\n\nScreenshot files:\n`;
  for (const png of pngs) {
    prompt += `- ${png}\n`;
  }

  const exampleFile = path.basename(pngs[0]);
  prompt += `\nReturn a single JSON object with results grouped by filename (basename only, not the full path). Each key should be the PNG filename, and each value should be an object with an "issues" array following the schema described above.\n\nExpected structure:\n{\n  "screenshots": {\n    "${exampleFile}": { "issues": [ ... ] }\n  }\n}\n\nOutput ONLY valid JSON. No markdown code fences, no explanatory text, no commentary — just the raw JSON object.\n`;

  return prompt;
}

// ---------------------------------------------------------------------------
// JSON parsing with truncation repair
// ---------------------------------------------------------------------------

/**
 * Parse a raw Claude response into a screenshots record.
 * Strips markdown fences, leading/trailing prose, and repairs the known
 * "missing trailing brace" flake (see memory: analyzer_json_flake.md).
 */
export function parseAnalysisResponse(raw: string): Record<string, { issues: unknown[] }> {
  let jsonText = raw.trim();

  // Strip markdown fences (handles ```json ... ``` and plain ``` ... ```)
  jsonText = jsonText
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?\s*```\s*$/, "");

  // Strip any leading non-JSON text (e.g. "Here is the analysis:")
  const jsonStart = jsonText.search(/\{/);
  if (jsonStart > 0) {
    jsonText = jsonText.slice(jsonStart);
  }

  // Strip any trailing non-JSON text after the last closing brace
  const lastBrace = jsonText.lastIndexOf("}");
  if (lastBrace >= 0 && lastBrace < jsonText.length - 1) {
    jsonText = jsonText.slice(0, lastBrace + 1);
  }

  let data: { screenshots?: Record<string, { issues: unknown[] }> };
  try {
    data = JSON.parse(jsonText);
  } catch (originalErr) {
    // Known flake: Claude CLI sometimes truncates 1–5 trailing closing braces.
    let repaired: typeof data | null = null;
    for (let i = 1; i <= 5; i++) {
      try {
        repaired = JSON.parse(jsonText.trimEnd() + "}".repeat(i));
        break;
      } catch {
        // try more braces
      }
    }
    if (!repaired) {
      throw new Error(
        `Failed to parse analysis JSON: ${(originalErr as Error).message}. ` +
          `First 300 chars of response: ${raw.slice(0, 300)}`,
      );
    }
    data = repaired;
  }

  if (!data.screenshots || typeof data.screenshots !== "object") {
    throw new Error("Invalid analysis result: missing 'screenshots' object");
  }

  return data.screenshots;
}

// ---------------------------------------------------------------------------
// Bounded-concurrency batch runner
// ---------------------------------------------------------------------------

interface BatchTask {
  index: number;
  pngs: string[];
}

interface BatchOutcome {
  index: number;
  success: boolean;
  results?: Record<string, { issues: unknown[] }>;
  error?: string;
}

/**
 * Run an array of batch tasks with a fixed concurrency cap.
 * Worker-pool pattern: each worker pulls the next task off the shared queue.
 */
async function runWithConcurrency(
  tasks: BatchTask[],
  concurrency: number,
  worker: (task: BatchTask) => Promise<BatchOutcome>,
): Promise<BatchOutcome[]> {
  const results: BatchOutcome[] = new Array(tasks.length);
  let nextIdx = 0;

  async function pump(): Promise<void> {
    while (true) {
      const i = nextIdx++;
      if (i >= tasks.length) return;
      results[i] = await worker(tasks[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, pump);
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze every PNG under `screenshotsDir` by batching them into Claude
 * Vision calls and merging the results.
 *
 * Returns a merged screenshots map plus diagnostic counts. Per-batch failures
 * are captured (not thrown) so partial results survive a single bad batch.
 * Throws only if every batch fails.
 */
export async function analyzeScreenshotsDir(
  screenshotsDir: string,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  if (!fs.existsSync(PROMPT_FILE_PATH)) {
    throw new Error(`Analyzer prompt not found at ${PROMPT_FILE_PATH}`);
  }
  const basePrompt = fs.readFileSync(PROMPT_FILE_PATH, "utf-8");

  const pngs = fs
    .readdirSync(screenshotsDir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => path.join(screenshotsDir, f));

  if (pngs.length === 0) {
    return { screenshots: {}, totalBatches: 0, failedBatches: 0, errors: [] };
  }

  // Slice into batches
  const tasks: BatchTask[] = [];
  for (let i = 0; i < pngs.length; i += batchSize) {
    tasks.push({ index: tasks.length, pngs: pngs.slice(i, i + batchSize) });
  }

  // Worker
  const worker = async (task: BatchTask): Promise<BatchOutcome> => {
    const human = `batch ${task.index + 1}/${tasks.length} (${task.pngs.length} screenshot${task.pngs.length === 1 ? "" : "s"})`;
    opts.onProgress?.(`Analyzing ${human}...`, task.index, tasks.length);

    const prompt = buildAnalysisPrompt(task.pngs, basePrompt, opts.prdContext, opts.repoContext);

    try {
      const raw = await runClaudePrint(prompt, { label: `analyze-${task.index + 1}` });
      const results = parseAnalysisResponse(raw);
      return { index: task.index, success: true, results };
    } catch (err) {
      return {
        index: task.index,
        success: false,
        error: (err as Error).message,
      };
    }
  };

  const outcomes = await runWithConcurrency(tasks, concurrency, worker);

  // Merge results
  const merged: Record<string, { issues: unknown[] }> = {};
  const errors: AnalyzeResult["errors"] = [];
  let failedBatches = 0;

  for (const outcome of outcomes) {
    if (outcome.success && outcome.results) {
      Object.assign(merged, outcome.results);
    } else {
      failedBatches++;
      errors.push({
        batchIndex: outcome.index,
        reason: outcome.error ?? "unknown error",
      });
    }
  }

  if (failedBatches === tasks.length) {
    throw new Error(
      `All ${tasks.length} analysis batch(es) failed. ` +
        `First failure: ${errors[0]?.reason}. ` +
        `Check that the Claude CLI is working: claude -p "hello"`,
    );
  }

  return {
    screenshots: merged,
    totalBatches: tasks.length,
    failedBatches,
    errors,
  };
}
