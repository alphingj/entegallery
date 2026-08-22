import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

/** GET /api/import/status — returns count of unscanned photos */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { count, error } = await sb
      .from("photos")
      .select("*", { count: "exact", head: true })
      .eq("face_scan_status", "pending");
    if (error) throw new Error(error.message);
    return NextResponse.json({ unscannedCount: count ?? 0 });
  } catch (err) {
    console.error("import/status:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}