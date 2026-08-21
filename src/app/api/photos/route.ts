import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PhotoRow } from "@/lib/types";

export const maxDuration = 30;

const PAGE_SIZE = 90;

/** GET /api/photos?cursor=<createdAt ISO> — gallery feed, newest first. */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const cursor = req.nextUrl.searchParams.get("cursor");

    let query = sb
      .from("photos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (cursor) query = query.lt("created_at", cursor);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const photos = (data ?? []) as PhotoRow[];
    return NextResponse.json({
      photos,
      nextCursor:
        photos.length === PAGE_SIZE
          ? photos[photos.length - 1].created_at
          : null,
    });
  } catch (err) {
    console.error("photos:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}
