#!/usr/bin/env tsx
/**
 * One-time Google OAuth consent flow.
 *
 * 1. Run `pnpm token`
 * 2. Open the printed URL in a browser, sign in with the Google account that
 *    owns the 4TB Drive folder, and grant access.
 * 3. The script catches the redirect, exchanges the code, and prints your
 *    GOOGLE_REFRESH_TOKEN — paste it into .env.local (and Vercel env vars).
 */

import http from "http";
import { URL } from "url";

const PORT = 51337;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/drive";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (OAuth client of type 'Desktop app').\n"
    + "You can inline them: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... pnpm token"
  );
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\n1. Open this URL in your browser:\n");
console.log(authUrl.toString());
console.log(`\n2. Waiting for the OAuth redirect on ${REDIRECT_URI} ...\n`);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error || !code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h3>Auth failed: ${error ?? "no code"}</h3>`);
      server.close();
      process.exit(1);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json()) as {
      refresh_token?: string;
      access_token?: string;
      error_description?: string;
    };

    if (!tokens.refresh_token) {
      console.error("No refresh_token returned:", tokens);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end("<h3>No refresh_token returned. Re-run and make sure you fully revoke+consent.</h3>");
      server.close();
      process.exit(1);
    }

    console.log("SUCCESS! Add these to .env.local (and Vercel):\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h3>Token received — check your terminal, then close this tab.</h3>");
    server.close();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
});

server.listen(PORT, () => {});
