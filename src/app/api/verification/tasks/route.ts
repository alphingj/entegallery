import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const kind = req.nextUrl.searchParams.get("kind");
    const status = req.nextUrl.searchParams.get("status") ?? "pending";
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20, 50);
    // Use explicit FK hints: verification_tasks -> photo_faces (face_a/b) -> photos ; verification_tasks -> people
    // Falls back to second query if embedding returns null (PostgREST alias quirks)
    let q = sb
      .from("verification_tasks")
      .select(
        "*, face_a:photo_faces!verification_tasks_face_a_id_fkey(id,bounding_box,photo_id,photos:photos!photo_faces_photo_id_fkey(thumbnail_url,file_name,google_drive_file_id,width,height)), face_b:photo_faces!verification_tasks_face_b_id_fkey(id,bounding_box,photo_id,photos:photos!photo_faces_photo_id_fkey(thumbnail_url,file_name,google_drive_file_id,width,height)), person:people!verification_tasks_person_id_fkey(id,name)"
      )
      .eq("status", status)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    // Fallback hydration if face_a is null due to FK name mismatch on older DBs
    const tasks = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const needsFallback = tasks.some((t) => !t.face_a && (t.face_a_id as string));
    if (needsFallback) {
      const ids = tasks.filter((t) => !t.face_a && t.face_a_id).map((t) => t.face_a_id as string);
      if (ids.length) {
        const { data: faces } = await sb
          .from("photo_faces")
          .select("id,bounding_box,photo_id,photos!inner(thumbnail_url,file_name,google_drive_file_id,width,height)")
          .in("id", ids);
        const byId = new Map((faces ?? []).map((f: unknown) => [(f as { id: string }).id, f]));
        for (const t of tasks) if (!t.face_a && t.face_a_id) t.face_a = byId.get(t.face_a_id as string) ?? null;
      }
    }
    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // generate up to 50 ambiguous pairs
  try {
    const sb = getSupabaseAdmin();
    const { count = 50 } = await req.json().catch(() => ({})) as { count?: number };
    // Flow 2: Unknown faces where best gap <0.08
    // For now create from photo_faces where person name=Unknown and not yet tasked
    const { data: unknowns, error: e1 } = await sb.from("photo_faces").select("id,person_id,people!inner(name)").eq("people.name", "Unknown").limit(200);
    if (e1) throw new Error(e1.message);
    let created = 0;
    for (const f of (unknowns as unknown as { id: string }[]) .slice(0, count)) {
      const { error } = await sb.from("verification_tasks").insert({ kind: "face_name", face_a_id: f.id }).select("id").maybeSingle();
      if (!error) created++;
      // ignore unique violations
    }
    return NextResponse.json({ created });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
