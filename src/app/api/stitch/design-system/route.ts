import { NextRequest, NextResponse } from "next/server";
import { setupDesignSystem } from "@/lib/stitch";
import { fromBrandConfig, DEFAULT_DESIGN_TOKENS } from "@/lib/stitch/design-system-defaults";
import { requireApiAuth, sanitizeError, logError } from "@/lib/security";

// Fonts are only alphanumeric + spaces + a few safe punctuation chars. This
// keeps an attacker from injecting CSS or prompt directives via a "fontFamily".
const SAFE_FONT_FAMILY = /^[a-zA-Z0-9 _,'\-]{1,64}$/;

export async function GET(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;
  // Do not leak the design-system id on this endpoint.
  return NextResponse.json({ tokens: DEFAULT_DESIGN_TOKENS });
}

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

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

    // Validate hex colors
    const hexPattern = /^#[0-9a-f]{6}$/i;
    for (const [name, value] of Object.entries({ primaryColor, secondaryColor, accentColor })) {
      if (!hexPattern.test(value)) {
        return NextResponse.json(
          { error: `Invalid ${name}: must be a 6-digit hex color (e.g. #2563eb)` },
          { status: 400 },
        );
      }
    }

    if (!SAFE_FONT_FAMILY.test(fontFamily)) {
      return NextResponse.json(
        { error: "Invalid fontFamily: letters, digits, spaces, dashes, commas, quotes only (max 64 chars)." },
        { status: 400 },
      );
    }

    const tokens = fromBrandConfig({ primaryColor, secondaryColor, fontFamily, accentColor });
    const designSystem = await setupDesignSystem(projectId, tokens);

    return NextResponse.json(designSystem);
  } catch (error) {
    logError("[stitch/design-system]", error);
    return NextResponse.json(
      { error: sanitizeError(error, "Failed to set up design system.") },
      { status: 500 },
    );
  }
}
