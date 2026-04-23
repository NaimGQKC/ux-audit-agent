import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import {
  requireApiAuth,
  rateLimitCheck,
  clientIp,
  hashIdentifier,
  logError,
} from "@/lib/security";

const execFileAsync = promisify(execFile);

// Files to extract from the repo (in priority order)
const TARGET_FILES = [
  "CLAUDE.md",
  "README.md",
  "package.json",
  "tsconfig.json",
  "tailwind.config.ts",
  "tailwind.config.js",
  ".eslintrc.json",
  ".eslintrc.js",
  "src/lib/design-tokens.ts",
  "src/styles/tokens.ts",
  "src/theme.ts",
  "src/styles/globals.css",
  "app/globals.css",
  "src/app/globals.css",
];

// Glob patterns to search for design system files
const DESIGN_PATTERNS = [
  "**/design-tokens*",
  "**/tokens.*",
  "**/theme.*",
  "**/design-system*",
];

interface RepoContextResponse {
  repoUrl: string;
  files: { path: string; content: string }[];
  summary: string;
}

function isValidGitHubUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return false;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    // Validate owner/repo contain only safe characters (no shell metacharacters)
    const safePattern = /^[a-zA-Z0-9._-]+$/;
    if (!safePattern.test(parts[0]) || !safePattern.test(parts[1])) return false;
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  // Git clone is expensive (disk + network). Rate-limit per client to stop
  // a single attacker from chewing through disk or saturating git servers.
  const ip = clientIp(request.headers as unknown as Record<string, string | undefined>);
  const limit = rateLimitCheck(hashIdentifier(ip), {
    limit: 10,
    windowMs: 10 * 60 * 1000,
    namespace: "fetch-repo-context",
  });
  if (!limit.allowed) {
    return Response.json(
      { error: "Rate limit exceeded. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let body: { repoUrl: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.repoUrl || typeof body.repoUrl !== "string") {
    return Response.json({ error: "Missing required field: repoUrl" }, { status: 400 });
  }

  const repoUrl = body.repoUrl.trim().replace(/\/$/, "");

  if (!isValidGitHubUrl(repoUrl)) {
    return Response.json(
      { error: "Invalid GitHub URL. Expected format: https://github.com/owner/repo" },
      { status: 400 },
    );
  }

  const cloneDir = path.join(os.tmpdir(), `ux-audit-repo-${Date.now()}`);

  try {
    // Shallow clone — only latest commit, no blobs yet (treeless)
    // Use execFile with argument arrays to prevent shell injection.
    const gitUrl = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`;
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", gitUrl, cloneDir],
      { timeout: 30_000 },
    );

    // Sparse-checkout the files we care about
    await execFileAsync("git", ["sparse-checkout", "init", "--cone"], { cwd: cloneDir, timeout: 10_000 });
    const sparseCheckoutDirs = TARGET_FILES
      .map((f) => path.dirname(f) || ".")
      .filter((v, i, a) => a.indexOf(v) === i);
    await execFileAsync(
      "git",
      ["sparse-checkout", "set", ...sparseCheckoutDirs],
      { cwd: cloneDir, timeout: 10_000 },
    );
    await execFileAsync("git", ["checkout"], { cwd: cloneDir, timeout: 10_000 });

    // Collect files that exist
    const files: { path: string; content: string }[] = [];
    let totalSize = 0;
    const MAX_TOTAL_SIZE = 50_000; // ~50KB cap to keep prompt reasonable

    for (const relPath of TARGET_FILES) {
      const fullPath = path.join(cloneDir, relPath);
      if (fs.existsSync(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile() && stat.size < 20_000 && totalSize + stat.size < MAX_TOTAL_SIZE) {
            const content = fs.readFileSync(fullPath, "utf-8");
            files.push({ path: relPath, content });
            totalSize += content.length;
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Also look for design-system files by pattern
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-files", ...DESIGN_PATTERNS],
        { cwd: cloneDir, timeout: 5_000 },
      );
      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        // Guard against path traversal in git output
        if (line.includes("..") || path.isAbsolute(line)) continue;
        const already = files.some((f) => f.path === line);
        if (!already && totalSize < MAX_TOTAL_SIZE) {
          const fullPath = path.join(cloneDir, line);
          // Ensure resolved path stays within cloneDir
          if (!path.resolve(fullPath).startsWith(path.resolve(cloneDir))) continue;
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            if (stat.isFile() && stat.size < 20_000) {
              const content = fs.readFileSync(fullPath, "utf-8");
              files.push({ path: line, content });
              totalSize += content.length;
            }
          }
        }
      }
    } catch {
      // Pattern search failed — fine, we have the main files
    }

    // Build a summary
    const summary = files.map((f) => `- ${f.path} (${f.content.length} chars)`).join("\n");

    const result: RepoContextResponse = { repoUrl, files, summary };
    return Response.json(result);
  } catch (err) {
    logError("[fetch-repo-context]", err);
    // Sanitize error message — don't leak filesystem paths or command details
    const rawMsg = (err as Error).message || "";
    let safeMsg = "Failed to fetch repository.";
    if (rawMsg.includes("timed out") || rawMsg.includes("ETIMEDOUT")) {
      safeMsg = "Repository fetch timed out. Is the URL correct and the repo public?";
    } else if (rawMsg.includes("Repository not found") || rawMsg.includes("not found")) {
      safeMsg = "Repository not found. Is the URL correct and the repo public?";
    } else if (rawMsg.includes("Authentication") || rawMsg.includes("denied")) {
      safeMsg = "Repository access denied. Only public repos are supported.";
    }
    return Response.json({ error: safeMsg }, { status: 500 });
  } finally {
    // Clean up
    try {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}
