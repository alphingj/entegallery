import { NextRequest, NextResponse } from "next/server";
import { DetectedFacePayload } from "@/lib/types";
import {
  DriveError,
  driveThumbnailUrl,
  getFileMeta,
  setLinkShared,
} from "@/lib/google-drive";
import { getSupabaseAdmin } from "@/lib/supabase";
import { matchAndLinkFaces } from "@/lib/face-matcher";

export const maxDuration = 60;

interface ConfirmBody {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  faces?: DetectedFacePayload[];
}

/**
 * Called by the browser after it has PUT the file bytes straight to Drive.
 * Verifies the file exists, makes it link-shareable (thumbnail CDN), stores the
 * photo row, and matches every face descriptor against known people.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ConfirmBody;
    if (!body.fileId || typeof body.fileId !== "string") {
      return NextResponse.json({ error: "fileId required" }, { status: 400 });
    }

    // 1. Verify the upload actually landed in Drive.
    const meta = await getFileMeta(body.fileId);

    // 2. Make link-shareable so thumbnails render without tokens.
    await setLinkShared(body.fileId);

    const sb = getSupabaseAdmin();

    // 3. Photo row (idempotent on Drive file id).
    let photoId: string;
    const { data: existing } = await sb
      .from("photos")
      .select("id")
      .eq("google_drive_file_id", body.fileId)
      .maybeSingle();
    if (existing) {
      photoId = existing.id as string;
    } else {
      const { data: inserted, error } = await sb
        .from("photos")
        .insert({
          google_drive_file_id: body.fileId,
          file_name: body.fileName ?? meta.name,
          mime_type: body.mimeType ?? meta.mimeType,
          byte_size: body.byteSize ?? null,
          width:
            body.width ?? meta.imageMediaMetadata?.width ?? null,
          height:
            body.height ?? meta.imageMediaMetadata?.height ?? null,
          thumbnail_url: driveThumbnailUrl(body.fileId),
        })
        .select("id")
        .single();
      if (error) throw new Error(`photo insert failed: ${error.message}`);
      photoId = inserted.id as string;
    }

    // 4. Faces: batch-match against pre-photo state, then link/create.
    const diagnostics = await matchAndLinkFaces(sb, photoId, body.faces ?? []);
    console.log("upload/confirm matches:", JSON.stringify(diagnostics));

    return NextResponse.json({
      photoId,
      tagged: diagnostics.map((d) => ({ name: d.name, matched: d.matched })),
      diagnostics,
    });
  } catch (err) {
    const status = err instanceof DriveError ? err.status : 500;
    console.error("upload/confirm:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "confirm failed" },
      { status }
    );
  }
}
