import { NextRequest, NextResponse } from "next/server";
import {
  DriveError,
  getFileStream,
} from "@/lib/google-drive";

export const maxDuration = 60;

/**
 * Streams a full-resolution image from Google Drive.
 * Long-lived immutable cache: file content in Drive never changes for a given id.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await ctx.params;
    const range = req.headers.get("range") ?? undefined;
    const upstream = await getFileStream(fileId, range);

    const headers = new Headers();
    const passthrough = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
    ];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    const status = err instanceof DriveError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "image fetch failed" },
      { status }
    );
  }
}
