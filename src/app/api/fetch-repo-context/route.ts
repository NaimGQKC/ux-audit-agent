import { NextRequest } from "next/server";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
    return (
      (url.hostname === "github.com" || url.hostname === "www.github.com") &&
      url.pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
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
    const gitUrl = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`;
    await execAsync(
      `git clone --depth 1 --filter=blob:none --sparse "${gitUrl}" "${cloneDir}"`,
      { timeout: 30_000 },
    );

    // Sparse-checkout the files we care about
    await execAsync("git sparse-checkout init --cone", { cwd: cloneDir, timeout: 10_000 });
    await execAsync(
      `git sparse-checkout set ${TARGET_FILES.map((f) => path.dirname(f) || ".").filter((v, i, a) => a.indexOf(v) === i).join(" ")}`,
      { cwd: cloneDir, timeout: 10_000 },
    );
    await execAsync("git checkout", { cwd: cloneDir, timeout: 10_000 });

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
      const { stdout } = await execAsync(
        `git ls-files ${DESIGN_PATTERNS.map((p) => `"${p}"`).join(" ")}`,
        { cwd: cloneDir, timeout: 5_000 },
      );
      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const already = files.some((f) => f.path === line);
        if (!already && totalSize < MAX_TOTAL_SIZE) {
          const fullPath = path.join(cloneDir, line);
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
    return Response.json(
      { error: `Failed to fetch repository: ${(err as Error).message}` },
      { status: 500 },
    );
  } finally {
    // Clean up
    try {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}
