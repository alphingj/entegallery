import { NextRequest, NextResponse } from "next/server";
import { DriveError, trashFile } from "@/lib/google-drive";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

/** DELETE /api/photos/:id — trash the Drive file and delete the DB row (cascade removes faces) */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const sb = getSupabaseAdmin();

    // Get the Drive file id before deleting
    const { data: photo, error: pErr } = await sb
      .from("photos")
      .select("google_drive_file_id")
      .eq("id", id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!photo) {
      return NextResponse.json({ error: "photo not found" }, { status: 404 });
    }

    // Move Drive file to trash (recoverable in Drive trash for 30 days)
    await trashFile(photo.google_drive_file_id);

    // Delete DB row (cascade removes photo_faces)
    const { error: delErr } = await sb.from("photos").delete().eq("id", id);
    if (delErr) throw new Error(delErr.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof DriveError ? err.status : 500;
    console.error("delete photo:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status }
    );
  }
}