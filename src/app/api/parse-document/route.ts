import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Enforce file size limit (10 MB) to prevent memory exhaustion
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.` },
        { status: 400 },
      );
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

    // Cap extracted text to 500 KB to keep prompts reasonable
    const MAX_TEXT_LENGTH = 500_000;
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH) + "\n\n[Truncated — document exceeds 500 KB text limit]";
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
