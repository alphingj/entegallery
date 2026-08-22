/**
 * Google Drive access via OAuth (acts as the folder owner's account).
 * Docs: https://developers.google.com/drive/api/v3/reference
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB

let cachedToken: { token: string; expiresAt: number } | null = null;

export class DriveError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new DriveError(`Missing environment variable ${name}.`, 500);
  return v;
}

/** Refresh + cache an access token from the stored refresh token. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new DriveError(
      `Google token refresh failed (${res.status}): ${await res.text()}`,
      502
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

/**
 * Stable thumbnail URL served by Google's CDN. Requires the file to have an
 * "anyone with link → reader" permission, which we grant on upload confirm.
 */
export function driveThumbnailUrl(fileId: string, size = "w2048"): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=${size}`;
}

/**
 * Step 1 of the upload pipeline: ask Drive for a resumable upload session URI.
 * The browser then PUTs the file bytes directly to that URI — no file content
 * ever passes through Vercel serverless functions.
 *
 * `origin` MUST be the browser's Origin: Google only attaches CORS headers to
 * the session's PUT responses when the session request itself carried an
 * Origin, otherwise browsers block reading the response.
 */
export async function createResumableSession(opts: {
  fileName: string;
  mimeType: string;
  byteSize: number;
  origin?: string;
}): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": opts.mimeType,
        "X-Upload-Content-Length": String(opts.byteSize),
        ...(opts.origin ? { Origin: opts.origin } : {}),
      },
      body: JSON.stringify({
        name: opts.fileName,
        mimeType: opts.mimeType,
        parents: [requireEnv("GOOGLE_DRIVE_FOLDER_ID")],
      }),
    }
  );
  if (!res.ok) {
    throw new DriveError(
      `Drive resumable session failed (${res.status}): ${await res.text()}`,
      502
    );
  }
  const location = res.headers.get("location");
  if (!location) throw new DriveError("Drive did not return a session URI.", 502);
  return location;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  imageMediaMetadata?: { width?: number; height?: number };
}

export async function getFileMeta(fileId: string): Promise<DriveFileMeta> {
  const token = await getAccessToken();
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,imageMediaMetadata&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new DriveError(
      `Drive metadata lookup failed (${res.status}) for ${fileId}`,
      res.status === 404 ? 404 : 502
    );
  }
  return res.json();
}

/** Grant "anyone with link → viewer" so Google's thumbnail CDN works. */
export async function setLinkShared(fileId: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    }
  );
  if (!res.ok && res.status !== 409) {
    // 409/already-shared is fine; anything else we log but don't fail the upload —
    // thumbnails can be granted retroactively.
    console.warn(`setLinkShared(${fileId}) -> ${res.status}: ${await res.text()}`);
  }
}

/** Stream the raw file from Drive (used by /api/image/[fileId]). */
export async function getFileStream(
  fileId: string,
  rangeHeader?: string
): Promise<Response> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (rangeHeader) headers.Range = rangeHeader;

  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers }
  );
  if (!res.ok && res.status !== 206) {
    throw new DriveError(
      `Drive media fetch failed (${res.status}) for ${fileId}`,
      res.status === 404 ? 404 : 502
    );
  }
  return res;
}
