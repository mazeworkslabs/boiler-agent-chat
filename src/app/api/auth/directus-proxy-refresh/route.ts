import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get("refresh_token")?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  const directusUrl = process.env.DIRECTUS_URL || "https://cms.businessfalkenberg.se";

  const res = await fetch(`${directusUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken, mode: "json" }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Refresh failed" }, { status: 401 });
  }

  const data = await res.json();
  const { access_token, refresh_token: newRefreshToken, expires } = data.data;

  const response = NextResponse.json({ ok: true });

  response.cookies.set("access_token", access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(expires / 1000),
    path: "/",
  });

  response.cookies.set("refresh_token", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return response;
}
