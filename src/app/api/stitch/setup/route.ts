import { NextResponse } from "next/server";

export async function GET() {
  const connected = Boolean(process.env.STITCH_API_KEY);
  const hasDesignSystem = Boolean(process.env.STITCH_DESIGN_SYSTEM_ID);

  return NextResponse.json({
    connected,
    hasDesignSystem,
    ...(hasDesignSystem ? { designSystemId: process.env.STITCH_DESIGN_SYSTEM_ID } : {}),
  });
}
