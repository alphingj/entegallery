import { NextRequest, NextResponse } from "next/server";
import {
  ALLOWED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
  DriveError,
  createResumableSession,
} from "@/lib/google-drive";

export const maxDuration = 30;

/**
 * Returns a Google Drive resumable-upload session URI. The browser PUTs the
 * file bytes directly to that URI, bypassing Vercel's 4.5MB request limit.
 */
export async function POST(req: NextRequest) {
  try {
    const { fileName, mimeType, byteSize } = await req.json();

    if (typeof fileName !== "string" || fileName.length === 0) {
      return NextResponse.json({ error: "fileName required" }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported type ${mimeType}. Use JPEG, PNG, WebP or GIF.` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes.` },
        { status: 400 }
      );
    }

    const uploadUri = await createResumableSession({
      fileName,
      mimeType,
      byteSize,
    });
    return NextResponse.json({ uploadUri });
  } catch (err) {
    const status = err instanceof DriveError ? err.status : 500;
    console.error("upload/init:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload init failed" },
      { status }
    );
  }
}
