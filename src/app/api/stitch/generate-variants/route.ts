import { NextRequest, NextResponse } from "next/server";
import { generateVariants } from "@/lib/stitch";
import { requireApiAuth, sanitizeError, logError } from "@/lib/security";

const MAX_PROMPT_LENGTH = 4_000;

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { projectId, screenIds, prompt, count: rawCount } = body as {
      projectId?: string;
      screenIds?: string[];
      prompt?: string;
      count?: number;
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

    if (typeof prompt !== "string" || prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: `prompt must be a string up to ${MAX_PROMPT_LENGTH} chars.` },
        { status: 400 },
      );
    }

    // Clamp count to [1, 5], default 3. Guard against NaN.
    const numericCount = typeof rawCount === "number" && !isNaN(rawCount) ? rawCount : 3;
    const count = Math.max(1, Math.min(5, numericCount));

    const variants = await generateVariants({ projectId, screenIds, prompt, count });

    return NextResponse.json({ variants });
  } catch (error) {
    logError("[stitch/generate-variants]", error);
    return NextResponse.json(
      { error: sanitizeError(error, "Failed to generate variants.") },
      { status: 500 },
    );
  }
}
