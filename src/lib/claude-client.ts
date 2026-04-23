/**
 * Unified Claude client — picks SDK or CLI transparently.
 *
 *  - SDK path (Anthropic API, claude-opus-4-7) is used when ANTHROPIC_API_KEY
 *    is set. This is the production path for the remote HTTP MCP server.
 *  - CLI path (`claude -p`) is used otherwise. This keeps local-dev flows
 *    (stdio MCP, Next.js dashboard) running at zero additional API cost via
 *    the user's Claude Code subscription.
 *
 * Both paths accept the same input: a prompt prefix (cacheable on SDK), a
 * list of image file paths, and a suffix (instructions, image list, schema).
 * The CLI path flattens everything into one text prompt that references the
 * images by filesystem path; the SDK path sends images as inline base64.
 */

import { runClaudePrint, checkClaudeHealth } from "./claude";
import { runClaudeSDK, checkSDKHealth, hasApiKey } from "./claude-sdk";

export type Transport = "sdk" | "cli";

/** Which transport will be used for the next call. */
export function activeTransport(): Transport {
  if (hasApiKey()) return "sdk";
  // Allow forcing CLI even if API key is set — useful for local zero-cost dev.
  if (process.env.CLAUDE_FORCE_CLI === "1") return "cli";
  return "cli";
}

/**
 * Force the SDK path regardless of the default. Throws if no API key is set.
 * Used by the remote HTTP server where the CLI is definitely unavailable.
 */
export function requireSDK(): void {
  if (!hasApiKey()) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for the remote MCP server. Set it as a Fly secret.",
    );
  }
}

export interface RunClaudeOptions {
  /** Cached prefix — static portion of the prompt (framework, PRD, repo context). */
  cachedPrefix: string;
  /** Per-call suffix — dynamic portion (image list, schema reminder). */
  suffix: string;
  /** Image paths to analyze. */
  imagePaths: string[];
  /** Label for logging. */
  label?: string;
  /** Override model (SDK path only). */
  model?: string;
  /** Force a specific transport. Default: auto. */
  transport?: Transport;
}

/**
 * Run a vision call through whichever transport is configured.
 */
export async function runClaude(opts: RunClaudeOptions): Promise<string> {
  const transport = opts.transport ?? activeTransport();

  if (transport === "sdk") {
    return runClaudeSDK({
      cachedPrefix: opts.cachedPrefix,
      suffix: opts.suffix,
      imagePaths: opts.imagePaths,
      label: opts.label,
      model: opts.model,
    });
  }

  // CLI path: flatten to single prompt with filesystem references.
  // The CLI reads files when paths are mentioned in the prompt.
  const fileList = opts.imagePaths.map((p) => `- ${p}`).join("\n");
  const prompt = `${opts.cachedPrefix}\n\nScreenshot files:\n${fileList}\n\n${opts.suffix}`;
  return runClaudePrint(prompt, { label: opts.label });
}

/**
 * Health check for whichever transport is active.
 */
export async function checkClaudeClientHealth(): Promise<{ ok: boolean; error?: string; transport: Transport }> {
  const transport = activeTransport();
  const result = transport === "sdk" ? await checkSDKHealth() : await checkClaudeHealth();
  return { ...result, transport };
}
