import { NextRequest, NextResponse } from "next/server";
import { BoundingBox, FaceItem } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

interface FaceJoinRow {
  id: string;
  bounding_box: BoundingBox;
  created_at: string;
  photo_id: string;
  photos: {
    google_drive_file_id: string;
    file_name: string | null;
    thumbnail_url: string | null;
    width: number | null;
    height: number | null;
    created_at: string;
  };
}

/**
 * GET /api/photos/by-person/:id?highlight=<faceId>
 * All appearances of one person, each as {photo, box} so the UI can render
 * that person's actual face crop even when the photo has many faces.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const sb = getSupabaseAdmin();

    const { data, error } = await sb
      .from("photo_faces")
      .select(
        "id, bounding_box, created_at, photo_id, photos(google_drive_file_id, file_name, thumbnail_url, created_at)"
      )
      .eq("person_id", id)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const items: FaceItem[] =
      data?.map((row: unknown) => {
        const r = row as unknown as FaceJoinRow;
        return {
          faceId: r.id,
          photoId: r.photo_id,
          fileId: r.photos.google_drive_file_id,
          fileName: r.photos.file_name,
          thumbnailUrl: r.photos.thumbnail_url,
          box: r.bounding_box,
          width: r.photos.width,
          height: r.photos.height,
          createdAt: r.created_at,
        };
      }) ?? [];

    return NextResponse.json({ items });
  } catch (err) {
    console.error("by-person:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}
