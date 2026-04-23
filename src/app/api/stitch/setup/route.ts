import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/security";

export async function GET(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const connected = Boolean(process.env.STITCH_API_KEY);
  const hasDesignSystem = Boolean(process.env.STITCH_DESIGN_SYSTEM_ID);

  // Never echo the design-system id back to the client — a caller with
  // workspace access can derive it from Stitch directly. Surfacing it on
  // an unauthenticated-by-default endpoint was just a leak.
  return NextResponse.json({ connected, hasDesignSystem });
}
