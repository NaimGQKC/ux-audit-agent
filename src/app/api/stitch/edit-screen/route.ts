import { NextRequest, NextResponse } from "next/server";
import { editScreen } from "@/lib/stitch";
import { requireApiAuth, sanitizeError, logError } from "@/lib/security";

const MAX_PROMPT_LENGTH = 4_000;

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { projectId, screenIds, prompt } = body as {
      projectId?: string;
      screenIds?: string[];
      prompt?: string;
    };

    // Validate required fields
    if (!projectId || !screenIds || !prompt) {
      return NextResponse.json(
        { error: "Missing required fields: projectId, screenIds, prompt" },
        { status: 400 }
      );
    }

    if (!Array.isArray(screenIds) || screenIds.length === 0 || !screenIds.every((id) => typeof id === "string")) {
      return NextResponse.json(
        { error: "screenIds must be a non-empty array of strings" },
        { status: 400 }
      );
    }

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ error: "prompt must be a non-empty string" }, { status: 400 });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: `prompt is too long (max ${MAX_PROMPT_LENGTH} chars).` },
        { status: 400 },
      );
    }

    const result = await editScreen({ projectId, screenIds, prompt: prompt.trim() });

    return NextResponse.json(result);
  } catch (error) {
    logError("[stitch/edit-screen]", error);
    return NextResponse.json(
      { error: sanitizeError(error, "Failed to edit screen.") },
      { status: 500 },
    );
  }
}
