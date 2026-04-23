/**
 * Anthropic SDK client for vision-based UX analysis.
 *
 * Use this path on the remote MCP server (Fly.io) where the `claude` CLI is
 * unavailable. The local stdio MCP + Next.js dev UI can keep using the CLI
 * helper (claude.ts) so they run at zero additional API cost.
 *
 * Design choices:
 *  - Model: claude-opus-4-7 (latest Opus, strongest at vision + structured
 *    JSON output). Configurable via CLAUDE_MODEL env for future migrations.
 *  - Prompt caching: the base prompt (ux-analysis-prompt.txt, ~12k tokens)
 *    and the system prompt are cached with `cache_control: ephemeral`. Over
 *    a 10-page audit (~30 screenshots / 10 batches), this cuts input cost by
 *    ~90% and latency by ~30–40% because only the 3 image blocks per batch
 *    are re-processed. `ttl: "1h"` extends the cache window past the default
 *    5 min so multiple audits within an hour (re-runs, multi-page bursts,
 *    several audits against the same project) reuse the cached prefix
 *    instead of paying cache-write cost each time.
 *  - Images: sent as base64 inline blocks (the same way the CLI passed paths
 *    via the filesystem, but without needing a writable filesystem).
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 16_000; // Large to accommodate multi-screenshot JSON
const DEFAULT_TIMEOUT_MS = 360_000; // 6 min — matches CLI path
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 2_000;

const SYSTEM_PROMPT =
  "You are a senior UX and accessibility auditor. You evaluate interfaces against Nielsen heuristics, WCAG 2.1/2.2 AA, UX laws, Gestalt principles, and cognitive psychology. You always return valid JSON exactly as requested — no markdown fences, no prose, no commentary.";

// Lazy client — created on first use so the module is safe to import in
// environments that don't have the API key (e.g. the stdio server which
// falls back to the CLI path).
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Either export it or use the CLI client (claude.ts) for local dev.",
    );
  }
  client = new Anthropic({ apiKey, timeout: DEFAULT_TIMEOUT_MS });
  return client;
}

export function hasApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (e.status && (e.status === 429 || e.status === 529 || e.status === 503 || e.status === 500)) {
    return true;
  }
  const msg = (e.message || "").toLowerCase();
  return (
    msg.includes("overloaded") ||
    msg.includes("rate limit") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up")
  );
}

function inferMediaType(path: string): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function readImageBase64(imagePath: string): { data: string; mediaType: ReturnType<typeof inferMediaType> } {
  const buf = fs.readFileSync(imagePath);
  return {
    data: buf.toString("base64"),
    mediaType: inferMediaType(imagePath),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SDKAnalyzeOptions {
  /** Cached prefix — the long, static part of the prompt (e.g. the framework). */
  cachedPrefix: string;
  /** Per-call suffix — the dynamic part (image list, schema reminder). */
  suffix: string;
  /** Image paths to inline as base64. */
  imagePaths: string[];
  /** Label for logging. */
  label?: string;
  /** Override model (default: DEFAULT_MODEL). */
  model?: string;
  /** Override max_tokens. */
  maxTokens?: number;
}

/**
 * Run a vision analysis call against the Anthropic API.
 * Returns the raw text content of the first text block in the response.
 *
 * The prompt is split into a cached prefix (framework + PRD/repo context)
 * and a per-call suffix (image list + schema reminder). The prefix is marked
 * with cache_control so subsequent calls within 5 minutes share the cache.
 */
export async function runClaudeSDK(opts: SDKAnalyzeOptions): Promise<string> {
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const label = opts.label ?? "analyze";

  // Build content blocks: [cached_text, ...images, suffix_text]
  const imageBlocks = opts.imagePaths.map((p) => {
    const { data, mediaType } = readImageBase64(p);
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: mediaType, data },
    };
  });

  const content = [
    {
      type: "text" as const,
      text: opts.cachedPrefix,
      cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
    },
    ...imageBlocks,
    { type: "text" as const, text: opts.suffix },
  ];

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[${label}] Retry ${attempt}/${RETRY_ATTEMPTS} after ${delay}ms — ${(lastError as Error).message}`,
      );
      await sleep(delay);
    }

    try {
      const response = await getClient().messages.create({
        model,
        max_tokens: maxTokens,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        messages: [{ role: "user", content }],
      });

      // Collect all text blocks (Opus may split output)
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => ("text" in b ? (b as { text: string }).text : ""))
        .join("")
        .trim();

      if (!text) {
        throw new Error(`[${label}] Empty response from Anthropic API`);
      }

      return text;
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS && isTransient(err)) continue;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Health check — ping the API with a trivial message.
 */
export async function checkSDKHealth(): Promise<{ ok: boolean; error?: string }> {
  if (!hasApiKey()) return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  try {
    const response = await getClient().messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Respond with exactly: ok" }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? (b as { text: string }).text : ""))
      .join("")
      .trim()
      .toLowerCase();
    return { ok: text.includes("ok") };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
