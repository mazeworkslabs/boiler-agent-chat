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

  // Verify auth
  const accessToken = req.cookies.get("access_token")?.value;
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return new NextResponse(data, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }
}
