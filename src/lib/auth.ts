import { createHash } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "eg_session";

export function sessionToken(password: string): string {
  return createHash("sha256").update(`ente-gallery:${password}`).digest("hex");
}

export function expectedSessionToken(): string | null {
  const pw = process.env.ACCESS_PASSWORD;
  return pw ? sessionToken(pw) : null;
}

export function isValidPassword(password: string): boolean {
  const pw = process.env.ACCESS_PASSWORD;
  return !!pw && password === pw;
}

export async function isAuthenticated(): Promise<boolean> {
  const expected = expectedSessionToken();
  if (!expected) return true; // auth disabled when ACCESS_PASSWORD unset
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value === expected;
}
