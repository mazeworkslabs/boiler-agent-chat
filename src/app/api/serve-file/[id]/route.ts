import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../../server/db";
import { generatedFiles } from "../../../../../server/db/schema";
import { eq } from "drizzle-orm";
import { readFile } from "fs/promises";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // UUID is unguessable — no auth required for file serving.
  // This avoids 401s when tokens expire during long agent sessions
  // or when <img> tags don't include cookies.
  if (!id || id.length < 30) {
    return NextResponse.json({ error: "Invalid file ID" }, { status: 400 });
  }

  const [file] = await db
    .select()
    .from(generatedFiles)
    .where(eq(generatedFiles.id, id));

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const data = await readFile(file.filePath);

    // For images, allow inline display; for other files, trigger download
    const isImage = file.mimeType.startsWith("image/");
    const disposition = isImage
      ? `inline; filename="${file.filename}"`
      : `attachment; filename="${file.filename}"`;

    return new NextResponse(data, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": disposition,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }
}
