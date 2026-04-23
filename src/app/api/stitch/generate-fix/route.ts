import { NextRequest, NextResponse } from "next/server";
import { initProject, generateFix, getScreenImage } from "@/lib/stitch";
import type { GenerateFixRequest } from "@/lib/stitch/types";
import { requireApiAuth, sanitizeError, logError } from "@/lib/security";

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const {
      issueTitle,
      issueDescription,
      recommendation,
      severity,
      category,
      projectId: providedProjectId,
      auditUrl,
    } = body as {
      issueTitle?: string;
      issueDescription?: string;
      recommendation?: string;
      severity?: string;
      category?: string;
      projectId?: string;
      auditUrl?: string;
    };

    // Validate required fields
    if (!issueTitle || !issueDescription || !recommendation || !severity || !category) {
      return NextResponse.json(
        { error: "Missing required fields: issueTitle, issueDescription, recommendation, severity, category" },
        { status: 400 }
      );
    }

    // Create project if none provided
    let projectId = providedProjectId;
    if (!projectId) {
      const project = await initProject(auditUrl || "https://unknown.site");
      projectId = project.id;
    }

    // Generate the fix mockup
    const fixRequest: GenerateFixRequest = {
      projectId,
      issueTitle,
      issueDescription,
      recommendation,
      severity,
      category,
    };

    const fixResult = await generateFix(fixRequest);

    // Get the rendered image URL
    const imageUrl = await getScreenImage(fixResult.screenId);

    return NextResponse.json({
      screenId: fixResult.screenId,
      imageUrl,
      projectId,
    });
  } catch (error) {
    logError("[stitch/generate-fix]", error);
    return NextResponse.json(
      { error: sanitizeError(error, "Failed to generate fix mockup.") },
      { status: 500 },
    );
  }
}
