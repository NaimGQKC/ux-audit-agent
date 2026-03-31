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

    // Clamp count to [1, 5], default 3
    const count = Math.max(1, Math.min(5, rawCount ?? 3));

    const variants = await generateVariants({ projectId, screenIds, prompt, count });

    return NextResponse.json({ variants });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
