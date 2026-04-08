import { NextRequest, NextResponse } from "next/server";
import {
  createMultipleTickets,
  type UXIssue as AsanaUXIssue,
  type AsanaBatchResult,
} from "@/lib/asana";

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

interface IssuePayload {
  title: string;
  description: string;
  severity: "critical" | "major" | "minor";
  category: string;
  principle?: string;
  affected_element: string;
  steps_to_reproduce: string;
  suggested_fix: string;
  acceptance_criteria: string;
  affected_viewports: ("mobile" | "tablet" | "desktop")[];
  recommendation: string;
  assignee?: string;
}

interface AsanaRequestBody {
  issues: IssuePayload[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set(["critical", "major", "minor"]);

function validateIssues(issues: unknown): issues is IssuePayload[] {
  if (!Array.isArray(issues)) return false;

  return issues.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof item.title === "string" &&
      typeof item.description === "string" &&
      VALID_SEVERITIES.has(item.severity) &&
      typeof item.category === "string" &&
      typeof item.recommendation === "string"
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: AsanaRequestBody;
  try {
    body = (await request.json()) as AsanaRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.issues || !validateIssues(body.issues)) {
    return NextResponse.json(
      {
        error:
          "Invalid request. Expected { issues: [{ title, description, severity, category, recommendation }] }",
      },
      { status: 400 }
    );
  }

  if (body.issues.length === 0) {
    return NextResponse.json(
      { error: "No issues provided" },
      { status: 400 }
    );
  }

  // Map incoming payloads to the Asana module's UXIssue shape
  const asanaIssues: AsanaUXIssue[] = body.issues.map((issue) => ({
    title: issue.title,
    description: issue.description,
    severity: issue.severity,
    category: issue.category,
    ...(issue.principle ? { principle: issue.principle } : {}),
    affected_element: issue.affected_element,
    steps_to_reproduce: issue.steps_to_reproduce,
    suggested_fix: issue.suggested_fix,
    acceptance_criteria: issue.acceptance_criteria,
    affected_viewports: issue.affected_viewports,
    recommendation: issue.recommendation,
    ...(issue.assignee ? { assignee: issue.assignee } : {}),
  }));

  let result: AsanaBatchResult;
  try {
    result = await createMultipleTickets(asanaIssues);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create Asana tickets: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    created: result.created.map((task) => ({
      taskId: task.gid,
      name: task.name,
      url: task.url,
    })),
    failed: result.failed.map((f) => ({
      issue: f.issue.title,
      error: f.error,
    })),
    summary: {
      total: body.issues.length,
      created: result.created.length,
      failed: result.failed.length,
    },
  });
}
