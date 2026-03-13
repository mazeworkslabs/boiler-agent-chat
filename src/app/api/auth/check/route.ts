import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const accessToken = req.cookies.get("access_token")?.value;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const directusUrl = process.env.DIRECTUS_URL || "https://cms.businessfalkenberg.se";

  const res = await fetch(`${directusUrl}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const data = await res.json();
  return NextResponse.json({
    user: {
      email: data.data.email,
      first_name: data.data.first_name,
      last_name: data.data.last_name,
    },
  });
}
