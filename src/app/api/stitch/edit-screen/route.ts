import { NextResponse } from "next/server";
import { editScreen } from "@/lib/stitch";

export async function POST(request: Request) {
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

    const result = await editScreen({ projectId, screenIds, prompt });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
