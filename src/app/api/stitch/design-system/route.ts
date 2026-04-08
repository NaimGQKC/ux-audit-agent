import { NextResponse } from "next/server";
import { setupDesignSystem } from "@/lib/stitch";
import { fromBrandConfig, DEFAULT_DESIGN_TOKENS } from "@/lib/stitch/design-system-defaults";

export async function GET() {
  return NextResponse.json({
    designSystemId: process.env.STITCH_DESIGN_SYSTEM_ID || null,
    tokens: DEFAULT_DESIGN_TOKENS,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { primaryColor, secondaryColor, fontFamily, accentColor, projectId } = body as {
      primaryColor?: string;
      secondaryColor?: string;
      fontFamily?: string;
      accentColor?: string;
      projectId?: string;
    };

    // Validate required fields
    if (!primaryColor || !secondaryColor || !fontFamily || !accentColor || !projectId) {
      return NextResponse.json(
        { error: "Missing required fields: primaryColor, secondaryColor, fontFamily, accentColor, projectId" },
        { status: 400 }
      );
    }

    const tokens = fromBrandConfig({ primaryColor, secondaryColor, fontFamily, accentColor });
    const designSystem = await setupDesignSystem(projectId, tokens);

    return NextResponse.json(designSystem);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
