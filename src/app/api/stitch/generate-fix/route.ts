import { NextResponse } from "next/server";
import { initProject, generateFix, getScreenImage } from "@/lib/stitch";
import type { GenerateFixRequest } from "@/lib/stitch/types";

export async function POST(request: Request) {
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
