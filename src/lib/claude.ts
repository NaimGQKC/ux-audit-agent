/**
 * Shared helper for invoking the `claude` CLI in print mode.
 *
 * Replaces the @anthropic-ai/sdk dependency — all Claude calls now go
 * through the user's Claude Code subscription at zero additional API cost.
 *
 * Features:
 * - Configurable timeout (default 6 minutes)
 * - Retry with exponential backoff for transient failures
 * - 10 MB max buffer for large responses
 */

import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 360_000; // 6 minutes — vision analysis of multiple screenshots can be slow
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const RETRY_ATTEMPTS = 1; // 1 retry = 2 total attempts
const RETRY_BASE_DELAY_MS = 2_000; // 2 seconds base delay

/** Errors considered transient and worth retrying. */
function isTransient(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up") ||
    msg.includes("killed") ||
    msg.includes("spawn") ||
    // Claude CLI overload / rate limit signals
    msg.includes("overloaded") ||
    msg.includes("rate limit") ||
    msg.includes("529") ||
    msg.includes("503")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ClaudeOptions {
  /** Timeout in ms. Default: 360 000 (6 minutes). */
  timeoutMs?: number;
  /** Label for log messages. */
  label?: string;
}

/**
 * Quick health check: verify the Claude CLI is reachable and responding.
 * Runs `claude -p` with a trivial prompt and a short timeout.
 */
export async function checkClaudeHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    await execClaude("Respond with exactly: ok", 15_000, "healthcheck");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Run `claude -p` (print mode), piping the given prompt via stdin.
 * Returns the raw stdout output.
 *
 * Includes a 6-minute timeout and 1 retry with exponential backoff
 * for transient failures.
 */
export async function runClaudePrint(
  prompt: string,
  opts: ClaudeOptions = {},
): Promise<string> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = opts.label ?? "claude";

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[${label}] Retry ${attempt}/${RETRY_ATTEMPTS} after ${delay}ms — ${lastError?.message}`,
      );
      await sleep(delay);
    }

    try {
      return await execClaude(prompt, timeout, label);
    } catch (err) {
      lastError = err as Error;
      if (attempt < RETRY_ATTEMPTS && isTransient(lastError)) {
        continue;
      }
      throw lastError;
    }
  }

  // Unreachable, but satisfies TypeScript
  throw lastError;
}

function execClaude(
  prompt: string,
  timeoutMs: number,
  label: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      ["-p"],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        shell: true, // Required on Windows to resolve `claude` from PATH
      },
      (error, stdout, stderr) => {
        if (error) {
          // Distinguish timeout from other errors
          if (error.killed || (error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_TIMEOUT") {
            reject(
              new Error(
                `[${label}] Claude CLI timed out after ${Math.round(timeoutMs / 1000)}s. ` +
                  `Try reducing the input size or increasing the timeout.`,
              ),
            );
            return;
          }
          const detail = stderr?.trim() ? `: ${stderr.trim()}` : "";
          reject(new Error(`[${label}] Claude CLI failed${detail}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}
