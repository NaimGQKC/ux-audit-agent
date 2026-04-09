import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateAnalysisResult, type UXIssue } from "@/lib/analyzer";
import { type ViewportName, VIEWPORTS } from "@/lib/crawler";
import { runClaudePrint } from "@/lib/claude";
import { saveAuditToCache } from "@/lib/cache";

/** Max screenshots per Claude call to stay within context limits. */
const BATCH_SIZE = 6;

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSSEWriter(controller);

      try {
        await runScreenshotAudit(images, labels, sse, prdContext || undefined, repoContext || undefined);
      } catch (err) {
        sse.sendError((err as Error).message);
      } finally {
        sse.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
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

  // Load prompt template
  const promptFile = path.join(process.cwd(), "src", "lib", "analyzer", "ux-analysis-prompt.txt");
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Prompt file not found at ${promptFile}`);
  }
  const basePrompt = fs.readFileSync(promptFile, "utf-8");

  // Analyze in batches of BATCH_SIZE
  const allFilepaths = savedFiles.map((sf) => sf.filepath);
  const totalBatches = Math.ceil(allFilepaths.length / BATCH_SIZE);
  const mergedScreenshots: Record<string, unknown> = {};

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchFiles = allFilepaths.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
    const batchLabel = totalBatches > 1
      ? `Analyzing batch ${batchIdx + 1}/${totalBatches} (${batchFiles.length} screenshots)...`
      : `Analyzing ${batchFiles.length} screenshot(s)...`;

    sse.sendProgress(batchLabel, batchIdx, totalBatches);

    let prompt = "";
    if (prdContext) {
      prompt += `PROJECT CONTEXT:\n${prdContext}\n\nUse the project context above to evaluate the UI against actual product requirements and goals. Flag issues where the implementation diverges from stated requirements. Reference PRD requirements in acceptance_criteria where applicable.\n\n---\n\n`;
    }
    if (repoContext) {
      prompt += `REPOSITORY CONTEXT:\nThe following files were extracted from the project's GitHub repository. Use them to understand the design system, tech stack, component patterns, and project conventions. Reference specific design tokens, component names, or config values in your recommendations where relevant.\n\n${repoContext}\n\n---\n\n`;
    }
    prompt += basePrompt;
    prompt += `\n\n---\n\nAnalyze each of the following screenshot image files for UX and accessibility issues. Read each file listed below, then evaluate it against all the criteria described above.\n\nScreenshot files:\n`;
    for (const fp of batchFiles) {
      prompt += `- ${fp}\n`;
    }
    const exampleFile = path.basename(batchFiles[0]);
    prompt += `\nReturn a single JSON object with results grouped by filename (basename only, not the full path). Each key should be the PNG filename, and each value should be an object with an "issues" array following the schema described above.\n\nExpected structure:\n{\n  "screenshots": {\n    "${exampleFile}": { "issues": [ ... ] }\n  }\n}\n\nOutput ONLY valid JSON. No markdown code fences, no explanatory text, no commentary — just the raw JSON object.\n`;

    try {
      const raw = await runClaudePrint(prompt, { label: `upload-batch-${batchIdx + 1}` });
      let jsonText = raw.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "");
      // Strip leading/trailing non-JSON text
      const jsonStart = jsonText.search(/\{/);
      if (jsonStart > 0) jsonText = jsonText.slice(jsonStart);
      const lastBrace = jsonText.lastIndexOf("}");
      if (lastBrace >= 0 && lastBrace < jsonText.length - 1) jsonText = jsonText.slice(0, lastBrace + 1);
      const data = JSON.parse(jsonText) as { screenshots?: Record<string, unknown> };
      if (data.screenshots && typeof data.screenshots === "object") {
        Object.assign(mergedScreenshots, data.screenshots);
      }
    } catch (err) {
      sse.sendProgress(`Warning: batch ${batchIdx + 1}/${totalBatches} failed: ${(err as Error).message}`);
    }
  }

  sse.sendProgress("Reading analysis results...");
  const analysisData = { screenshots: mergedScreenshots };

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
