import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

/**
 * GET /api/photos/without-faces?limit=25
 * Photos with face_scan_status = 'pending' — the browser backfill queue.
 */
export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "25", 10) || 25, 1),
      100
    );
    const sb = getSupabaseAdmin();

    const { data, error } = await sb
      .from("photos")
      .select(
        "id, google_drive_file_id, file_name, width, height, mime_type"
      )
      .eq("face_scan_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(error.message);

    return NextResponse.json({ photos: data ?? [] });
  } catch (err) {
    console.error("without-faces:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}