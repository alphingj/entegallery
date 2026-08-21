import { NextRequest, NextResponse } from "next/server";
import { BoundingBox, DetectedFacePayload } from "@/lib/types";
import {
  DriveError,
  driveThumbnailUrl,
  getFileMeta,
  setLinkShared,
} from "@/lib/google-drive";
import { getSupabaseAdmin } from "@/lib/supabase";

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

function isValidBox(b: BoundingBox | undefined): b is BoundingBox {
  return (
    !!b &&
    [b.x, b.y, b.width, b.height].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1.5
    ) &&
    b.width > 0 &&
    b.height > 0
  );
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
    const threshold = parseFloat(
      process.env.NEXT_PUBLIC_FACE_MATCH_THRESHOLD ?? "0.4"
    );

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

    // 4. Faces: match each descriptor against all stored faces per person.
    const tagged: { name: string; personId: string }[] = [];
    for (const face of body.faces ?? []) {
      if (!Array.isArray(face.descriptor) || face.descriptor.length !== 128) continue;
      if (!isValidBox(face.box)) continue;

      let personId: string | null = null;
      let name: string | null = null;

      const { data: matches, error: matchError } = await sb.rpc(
        "match_person",
        { q: face.descriptor, max_dist: threshold }
      );
      if (matchError) throw new Error(`match_person failed: ${matchError.message}`);

      if (matches && matches.length > 0) {
        personId = matches[0].person_id as string;
        name = matches[0].name as string;
      } else {
        const { data: person, error: personErr } = await sb
          .from("people")
          .insert({ name: "Unknown", descriptor: face.descriptor })
          .select("id, name")
          .single();
        if (personErr) throw new Error(`person insert failed: ${personErr.message}`);
        personId = person.id as string;
        name = person.name as string;
      }

      const { error: faceErr } = await sb.from("photo_faces").insert({
        photo_id: photoId,
        person_id: personId,
        bounding_box: face.box,
        descriptor: face.descriptor,
      });
      if (faceErr) throw new Error(`face insert failed: ${faceErr.message}`);

      tagged.push({ personId, name });
    }

    return NextResponse.json({ photoId, tagged });
  } catch (err) {
    const status = err instanceof DriveError ? err.status : 500;
    console.error("upload/confirm:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "confirm failed" },
      { status }
    );
  }
}
