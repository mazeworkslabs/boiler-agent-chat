import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const directusUrl = process.env.DIRECTUS_URL || "https://cms.businessfalkenberg.se";

  const res = await fetch(`${directusUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Login failed" }, { status: 401 });
  }

  const data = await res.json();
  const { access_token, refresh_token, expires } = data.data;

  const response = NextResponse.json({ ok: true });

  response.cookies.set("access_token", access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(expires / 1000),
    path: "/",
  });

  response.cookies.set("refresh_token", refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
