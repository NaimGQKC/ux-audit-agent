/**
 * Tiny filesystem-backed store for per-project design standards.
 *
 * Each project is written to `.audit-projects/<projectId>.json` at the repo root.
 * The store is intentionally minimal: JSON-per-project, no locking, no migrations.
 * It lets users save their design system + brand docs once and reuse them across
 * audits — the analyzer reads `standardsDoc` as its prdContext slot.
 *
 * ProjectId validation: we only accept `[a-zA-Z0-9_-]{1,64}` to prevent path
 * traversal via `../` or absolute-path shenanigans.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  projectId: string;
  /** Human-readable name, 1–200 chars. */
  name: string;
  /** Markdown — destined for analyzer prdContext slot. */
  standardsDoc?: string;
  /** Freeform markdown or JSON text describing brand tokens. */
  brandTokens?: string;
  /** Freeform notes. */
  notes?: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

export interface ProjectListEntry {
  projectId: string;
  name: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const PROJECTS_DIR = path.join(process.cwd(), ".audit-projects");
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function assertProjectId(projectId: string): void {
  if (typeof projectId !== "string" || !PROJECT_ID_RE.test(projectId)) {
    throw new Error(
      `Invalid projectId: must match /^[a-zA-Z0-9_-]{1,64}$/ — got ${JSON.stringify(projectId)}`,
    );
  }
}

async function ensureProjectsDir(): Promise<string> {
  await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  return PROJECTS_DIR;
}

function projectPath(projectId: string): string {
  return path.join(PROJECTS_DIR, `${projectId}.json`);
}

/**
 * Derive a safe projectId from a human-readable name. The result is a slug
 * with an 8-char random hex suffix and always satisfies PROJECT_ID_RE.
 */
export function generateProjectId(name: string): string {
  const base = (typeof name === "string" ? name : "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const slug = base.length > 0 ? base : "project";
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${slug}-${suffix}`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Persist a project. If a project with this id already exists, the prior
 * `createdAt` is preserved; `updatedAt` is always bumped to now.
 * The store creates the projects directory on first write.
 */
export async function saveProject(projectId: string, project: Project): Promise<void> {
  assertProjectId(projectId);
  await ensureProjectsDir();

  // Preserve createdAt if a file already exists for this id.
  let createdAt = project.createdAt;
  try {
    const existingRaw = await fsp.readFile(projectPath(projectId), "utf-8");
    const existing = JSON.parse(existingRaw) as Partial<Project>;
    if (typeof existing.createdAt === "string") createdAt = existing.createdAt;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Malformed existing file — don't let it block the write, just overwrite.
    }
  }

  // Normalise: the canonical projectId for the file must match the payload.
  const normalised: Project = {
    ...project,
    projectId,
    createdAt,
    updatedAt: new Date().toISOString(),
  };
  const tmp = projectPath(projectId) + ".tmp";
  const final = projectPath(projectId);
  await fsp.writeFile(tmp, JSON.stringify(normalised, null, 2), "utf-8");
  await fsp.rename(tmp, final);
}

/**
 * Load a project by id. Returns `null` if the file is missing or malformed.
 * Callers should treat `null` as "not found".
 */
export async function loadProject(projectId: string): Promise<Project | null> {
  if (!PROJECT_ID_RE.test(projectId)) return null;

  const file = projectPath(projectId);
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Project>;
    if (
      typeof parsed !== "object" || parsed === null
      || typeof parsed.name !== "string"
      || typeof parsed.createdAt !== "string"
      || typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      projectId,
      name: parsed.name,
      standardsDoc: typeof parsed.standardsDoc === "string" ? parsed.standardsDoc : undefined,
      brandTokens: typeof parsed.brandTokens === "string" ? parsed.brandTokens : undefined,
      notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * List all projects, newest `updatedAt` first. Corrupt entries are silently
 * skipped so a single bad file can't take out the index.
 */
export async function listProjects(): Promise<ProjectListEntry[]> {
  // Don't create the dir just to list it — if it doesn't exist, return [].
  if (!fs.existsSync(PROJECTS_DIR)) return [];

  const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  const jsonFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".tmp.json"),
  );

  const out: ProjectListEntry[] = [];
  for (const entry of jsonFiles) {
    const projectId = entry.name.replace(/\.json$/, "");
    if (!PROJECT_ID_RE.test(projectId)) continue;

    try {
      const raw = await fsp.readFile(path.join(PROJECTS_DIR, entry.name), "utf-8");
      const parsed = JSON.parse(raw) as Partial<Project>;
      if (typeof parsed.name === "string" && typeof parsed.updatedAt === "string") {
        out.push({ projectId, name: parsed.name, updatedAt: parsed.updatedAt });
      }
    } catch {
      // Skip corrupt files — listing should never throw.
    }
  }

  out.sort((a, b) => {
    const ta = Date.parse(a.updatedAt) || 0;
    const tb = Date.parse(b.updatedAt) || 0;
    return tb - ta;
  });
  return out;
}

/**
 * Delete a project by id. Returns `true` if a file was removed, `false`
 * if the project didn't exist.
 */
export async function deleteProject(projectId: string): Promise<boolean> {
  if (!PROJECT_ID_RE.test(projectId)) return false;

  try {
    await fsp.unlink(projectPath(projectId));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Exposed for tests + route handlers that want to pre-validate input. */
export function isValidProjectId(projectId: string): boolean {
  return typeof projectId === "string" && PROJECT_ID_RE.test(projectId);
}

/**
 * Resolve the effective prdContext for an audit that MAY be pinned to a project.
 * If projectId is empty/undefined, returns the run prdContext unchanged.
 * If projectId is provided, loads the project and prepends its standardsDoc.
 *
 * Returns an ok/error union so callers can convert "unknown project" into
 * their own transport-appropriate error shape (HTTP 400, MCP tool isError).
 */
export async function resolveProjectPrdContext(
  projectId: string | undefined | null,
  runPrdContext: string | undefined,
): Promise<
  | { ok: true; prdContext: string | undefined; project: Project | null }
  | { ok: false; reason: "invalid_id" | "not_found" }
> {
  if (projectId === undefined || projectId === null || projectId === "") {
    return { ok: true, prdContext: runPrdContext, project: null };
  }
  if (typeof projectId !== "string" || !isValidProjectId(projectId)) {
    return { ok: false, reason: "invalid_id" };
  }
  const project = await loadProject(projectId);
  if (!project) {
    return { ok: false, reason: "not_found" };
  }
  const parts: string[] = [];
  if (project.standardsDoc && project.standardsDoc.trim().length > 0) {
    parts.push(`# Project conventions — ${project.name}\n\n${project.standardsDoc.trim()}`);
  }
  if (runPrdContext && runPrdContext.trim().length > 0) {
    parts.push(`# Per-run context\n\n${runPrdContext.trim()}`);
  }
  return {
    ok: true,
    prdContext: parts.length > 0 ? parts.join("\n\n---\n\n") : undefined,
    project,
  };
}
