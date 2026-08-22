import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { matchAndLinkFaces } from "@/lib/face-matcher";

export const maxDuration = 60;

interface BackfillBody {
  faces?: { descriptor: unknown; box: unknown }[];
  width?: number;
  height?: number;
}

/**
 * POST /api/photos/:id/faces/backfill
 * Browser-detected descriptors for an imported photo — same matching rules
 * as uploads (batch-match, margin guard).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as BackfillBody;
    const sb = getSupabaseAdmin();

    const { data: photo, error: pErr } = await sb
      .from("photos")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!photo) {
      return NextResponse.json({ error: "photo not found" }, { status: 404 });
    }

    // Fill in dimensions if the import didn't have them.
    if (typeof body.width === "number" && typeof body.height === "number") {
      await sb
        .from("photos")
        .update({ width: body.width, height: body.height })
        .eq("id", id);
    }

    const diagnostics = await matchAndLinkFaces(sb, id, body.faces ?? []);
    console.log(`backfill ${id}:`, JSON.stringify(diagnostics));

    return NextResponse.json({ ok: true, diagnostics });
  } catch (err) {
    console.error("backfill:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "backfill failed" },
      { status: 500 }
    );
  }
}
