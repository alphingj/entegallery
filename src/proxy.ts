import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

async function hash(input: string): Promise<string> {
  const data = new TextEncoder().encode(`ente-gallery:${input}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Password gate (Next.js 16 `proxy` convention, formerly `middleware`).
 * ACCESS_PASSWORD unset → app is open (e.g. local dev without auth).
 */
export async function proxy(req: NextRequest) {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === "/login";
  const isLoginApi = pathname === "/api/auth/login";

  const expected = await hash(password);
  const actual = req.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = !!actual && actual === expected;

  if (authenticated && isLoginPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (authenticated || isLoginPage || isLoginApi) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|models|api/auth/login|login).*)"],
};
