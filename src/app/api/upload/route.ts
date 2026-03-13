import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("access_token")?.value;
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  await mkdir(UPLOADS_DIR, { recursive: true });

  const uploaded: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }> = [];

  for (const file of files) {
    const id = crypto.randomUUID();
    const ext = path.extname(file.name) || "";
    const destFilename = `${id}${ext}`;
    const destPath = path.join(UPLOADS_DIR, destFilename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(destPath, buffer);

    uploaded.push({
      id,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: buffer.length,
    });
  }

  return NextResponse.json({ files: uploaded });
}
