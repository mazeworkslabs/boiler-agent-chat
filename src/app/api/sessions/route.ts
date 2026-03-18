import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../server/db";
import { chatSessions } from "../../../../server/db/schema";
import { eq, desc, and } from "drizzle-orm";

async function getUserEmail(req: NextRequest): Promise<string | null> {
  const accessToken = req.cookies.get("access_token")?.value;
  if (!accessToken) return null;

  const directusUrl = process.env.DIRECTUS_URL || "https://cms.businessfalkenberg.se";
  const res = await fetch(`${directusUrl}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.data.email;
}

export async function GET(req: NextRequest) {
  const email = await getUserEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.userEmail, email))
    .orderBy(desc(chatSessions.updatedAt));

  return NextResponse.json({ sessions });
}

export async function DELETE(req: NextRequest) {
  const email = await getUserEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId } = await req.json();
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // Only delete sessions owned by this user (cascade deletes messages, artifacts, files)
  const deleted = await db
    .delete(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userEmail, email)))
    .returning({ id: chatSessions.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
