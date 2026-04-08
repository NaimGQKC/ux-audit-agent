import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";

    switch (ext) {
      case "pdf": {
        // pdf-parse is CJS-only; dynamic import avoids ESM issues
        const pdfParse = (await import("pdf-parse")).default;
        const result = await pdfParse(buffer);
        text = result.text;
        break;
      }
      case "docx": {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
        break;
      }
      case "txt":
      case "md": {
        text = buffer.toString("utf-8");
        break;
      }
      default:
        return NextResponse.json(
          { error: `Unsupported file type: .${ext}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("Document parse error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Failed to parse document" },
      { status: 500 }
    );
  }
}
