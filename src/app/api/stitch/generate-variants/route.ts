import { NextResponse } from "next/server";
import { generateVariants } from "@/lib/stitch";

export async function POST(request: Request) {
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

    // Clamp count to [1, 5], default 3. Guard against NaN.
    const numericCount = typeof rawCount === "number" && !isNaN(rawCount) ? rawCount : 3;
    const count = Math.max(1, Math.min(5, numericCount));

    const variants = await generateVariants({ projectId, screenIds, prompt, count });

    return NextResponse.json({ variants });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
