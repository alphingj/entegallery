import { NextRequest, NextResponse } from "next/server";
import { BoundingBox } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

interface Row {
  id: string;
  bounding_box: BoundingBox;
  person_id: string;
  person_name: string;
}

/**
 * GET /api/photos/:id/faces
 * Every detected face in one photo — used to overlay boxes in the lightbox.
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
      .select("id, bounding_box, person_id, people!inner(name)")
      .eq("photo_id", id);

    if (error) throw new Error(error.message);

    const faces =
      data?.map((row: unknown) => {
        const r = row as Row & { people: { name: string } };
        return {
          faceId: r.id,
          personId: r.person_id,
          name: r.people.name,
          box: r.bounding_box,
        };
      }) ?? [];

    return NextResponse.json({ faces });
  } catch (err) {
    console.error("photo faces:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}
