import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateAnalysisResult, type UXIssue } from "@/lib/analyzer";
import { analyzeScreenshotsDir } from "@/lib/analyzer/run";
import { type ViewportName, VIEWPORTS } from "@/lib/crawler";
import { saveAuditToCache } from "@/lib/cache";
import { requireApiAuth, sanitizeError, logError } from "@/lib/security";

const ALLOWED_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

// ---------------------------------------------------------------------------
// Types (same output format as /api/audit)
// ---------------------------------------------------------------------------

interface ViewportAnalysis {
  screenshotPath: string;
  issues: UXIssue[];
}

interface PageResult {
  route: string;
  url: string;
  viewports: Record<ViewportName, ViewportAnalysis>;
}

interface AuditResult {
  baseUrl: string;
  timestamp: string;
  pages: PageResult[];
}

// ---------------------------------------------------------------------------
// SSE helpers (same as audit route)
// ---------------------------------------------------------------------------

type SSEWriter = {
  sendProgress: (detail: string, current?: number, total?: number) => void;
  sendResult: (data: AuditResult) => void;
  sendError: (message: string) => void;
  close: () => void;
};

function createSSEWriter(controller: ReadableStreamDefaultController<Uint8Array>): SSEWriter {
  const encoder = new TextEncoder();

  function send(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(encoder.encode(payload));
  }

  return {
    sendProgress(detail: string, current?: number, total?: number) {
      send("progress", { detail, ...(current != null && { current }), ...(total != null && { total }) });
    },
    sendResult(data: AuditResult) {
      send("result", data);
    },
    sendError(message: string) {
      send("error", { message });
    },
    close() {
      controller.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Route handler — accepts multipart form data with screenshots
// ---------------------------------------------------------------------------

export const maxDuration = 300;

const VIEWPORT_NAMES: ViewportName[] = Object.keys(VIEWPORTS) as ViewportName[];

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid form data" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Extract images and their labels
  // Form fields: images (File[]), labels (string[] — page name/URL for each image), prdContext (string)
  const images: File[] = [];
  const labels: string[] = [];
  const prdContext = formData.get("prdContext") as string | null;
  const repoContext = formData.get("repoContext") as string | null;

  // Collect all image entries
  const allEntries = formData.getAll("images");
  const allLabels = formData.getAll("labels");

  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];
    if (entry instanceof File && entry.size > 0) {
      const ext = entry.name.split(".").pop()?.toLowerCase();
      if (!ext || !ALLOWED_IMAGE_EXT.has(ext)) {
        return new Response(
          JSON.stringify({ error: `Unsupported image type: .${ext ?? "(none)"}` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      // Cap individual images to 15 MB — protects memory + matches frontend limit.
      if (entry.size > 15 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ error: `Image too large: ${(entry.size / 1024 / 1024).toFixed(1)} MB (max 15 MB).` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      images.push(entry);
      labels.push((allLabels[i] as string) || `Page ${i + 1}`);
    }
  }

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: "No images uploaded" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Cap total upload size to 50 MB to prevent memory exhaustion
  const totalBytes = images.reduce((acc, img) => acc + img.size, 0);
  if (totalBytes > 50 * 1024 * 1024) {
    return new Response(
      JSON.stringify({ error: `Total upload size (${(totalBytes / 1024 / 1024).toFixed(1)} MB) exceeds 50 MB limit.` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSSEWriter(controller);
      const encoder = new TextEncoder();

      // SSE heartbeat to prevent proxy/CDN idle disconnect
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      try {
        await runScreenshotAudit(images, labels, sse, prdContext || undefined, repoContext || undefined);
      } catch (err) {
        logError("[audit-screenshots]", err);
        sse.sendError(sanitizeError(err, "Screenshot audit failed."));
      } finally {
        clearInterval(heartbeat);
        sse.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// Core analysis pipeline for uploaded screenshots
// ---------------------------------------------------------------------------

async function runScreenshotAudit(
  images: File[],
  labels: string[],
  sse: SSEWriter,
  prdContext?: string,
  repoContext?: string,
): Promise<void> {
  sse.sendProgress(`Processing ${images.length} uploaded screenshot(s)...`);

  const sessionId = `ux-audit-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputDir = path.join(os.tmpdir(), sessionId);
  fs.mkdirSync(outputDir, { recursive: true });

  // Save images to temp directory
  const savedFiles: { filename: string; label: string; filepath: string }[] = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = image.name.split(".").pop()?.toLowerCase() || "png";
    const safeName = labels[i]
      .replace(/[^a-zA-Z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || `page-${i + 1}`;
    const filename = `${safeName}_desktop.${ext}`;
    const filepath = path.join(outputDir, filename);

    const buffer = Buffer.from(await image.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    savedFiles.push({ filename, label: labels[i], filepath });
  }

  sse.sendProgress(`Saved ${savedFiles.length} screenshot(s). Analyzing with Claude...`);

  // Use the shared batched analyzer — same implementation the /api/audit route uses,
  // including JSON truncation repair and bounded-concurrency batching.
  const analyzeResult = await analyzeScreenshotsDir(outputDir, {
    prdContext,
    repoContext,
    onProgress: (msg, current, total) => sse.sendProgress(msg, current, total),
  });

  for (const e of analyzeResult.errors) {
    sse.sendProgress(`Warning: batch ${e.batchIndex + 1} failed: ${e.reason}`);
  }

  sse.sendProgress("Reading analysis results...");
  const analysisData = { screenshots: analyzeResult.screenshots };

  // Map results — each uploaded image becomes a "page" with desktop viewport
  const pages: PageResult[] = savedFiles.map((sf) => {
    const viewports = {} as Record<ViewportName, ViewportAnalysis>;

    for (const vpName of VIEWPORT_NAMES) {
      if (vpName === "desktop") {
        const fileAnalysis = analysisData.screenshots[sf.filename] as
          | { issues: unknown[] }
          | undefined;

        let issues: UXIssue[] = [];
        if (fileAnalysis) {
          try {
            const validated = validateAnalysisResult(fileAnalysis);
            issues = validated.issues;
          } catch (err) {
            sse.sendProgress(
              `Warning: validation failed for ${sf.filename}: ${(err as Error).message}`
            );
          }
        }

        const url = `/api/screenshot?s=${encodeURIComponent(sessionId)}&f=${encodeURIComponent(sf.filename)}`;
        viewports[vpName] = { screenshotPath: url, issues };
      } else {
        viewports[vpName] = { screenshotPath: "", issues: [] };
      }
    }

    const route = `/${sf.label.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;
    return {
      route,
      url: sf.label.startsWith("http") ? sf.label : `uploaded://${sf.label}`,
      viewports,
    };
  });

  const result: AuditResult = {
    baseUrl: "uploaded://screenshots",
    timestamp: new Date().toISOString(),
    pages,
  };

  // Persist to cache
  try {
    saveAuditToCache(result, outputDir);
  } catch (err) {
    sse.sendProgress(`Warning: failed to cache results: ${(err as Error).message}`);
  }

  sse.sendProgress("Audit complete.", savedFiles.length, savedFiles.length);
  sse.sendResult(result);
}
