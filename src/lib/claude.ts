/**
 * Utility for invoking the `claude` CLI in print mode.
 *
 * Replaces the @anthropic-ai/sdk dependency — all Claude calls now go
 * through the user's Claude Code subscription at zero additional API cost.
 */

import { spawn } from "node:child_process";

/**
 * Run `claude -p` (print mode), piping the given prompt via stdin.
 * Returns the raw stdout output.
 */
export function runClaudePrint(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true, // Required on Windows to resolve `claude` from PATH
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start claude CLI: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(
            `claude CLI exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
