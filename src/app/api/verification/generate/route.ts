import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const { faceNameLimit = 50 } = await req.json().catch(() => ({})) as { faceNameLimit?: number };
    let createdFaceName = 0;
    // Create face_name tasks for Unknown faces that have no pending task yet
    const { data: pendingIds } = await sb.from("verification_tasks").select("face_a_id").eq("status", "pending").eq("kind", "face_name");
    const pendingSet = new Set((pendingIds ?? []).map((r: { face_a_id: string }) => r.face_a_id));
    const { data: unknowns } = await sb.from("photo_faces").select("id, people!inner(name)").eq("people.name", "Unknown").limit(300);
    for (const f of (unknowns as unknown as { id: string }[]) ?? []) {
      if (pendingSet.has(f.id)) continue;
      if (createdFaceName >= faceNameLimit) break;
      const { error } = await sb.from("verification_tasks").insert({ kind: "face_name", face_a_id: f.id }).select("id").maybeSingle();
      if (!error) createdFaceName++;
    }
    return NextResponse.json({ createdFaceName, createdSamePerson: 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
