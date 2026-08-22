import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

interface Decision {
  faceId: string;
  decision: "confirm" | "reject" | "skip";
  correctPersonId?: string;
  newName?: string;
}

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const { decisions } = await req.json() as { decisions: Array<{ faceId: string; decision: "confirm" | "reject" | "skip"; correctPersonId?: string; newName?: string }> };

    if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
      return NextResponse.json({ error: "decisions array required" }, { status: 400 });
    }

    let processed = 0;

    for (const item of decisions) {
      const { faceId, decision, correctPersonId, newName } = item;

      if (!faceId || !["confirm", "reject", "skip"].includes(decision)) {
        continue;
      }

      // Get the verification task for this face
      const { data: task, error: taskErr } = await getSupabaseAdmin()
        .from("verification_tasks")
        .select("id, kind, face_a_id, face_b_id, person_id")
        .eq("face_a_id", faceId)
        .eq("status", "pending")
        .maybeSingle();

      if (taskErr || !task) continue;

      if (decision === "confirm") {
        if (task.kind === "face_name") {
          // Confirm the suggested person
          await sb.from("photo_faces").update({ person_id: task.person_id }).eq("id", task.face_a_id);
        } else if (task.kind === "same_person") {
          // For same_person, merge face_b into face_a's person
          const { data: faceB } = await getSupabaseAdmin().from("photo_faces").select("person_id").eq("id", task.face_b_id).single();
          if (faceB) {
            await sb.from("photo_faces").update({ person_id: task.person_id }).eq("person_id", faceB.person_id);
          }
        }
        await sb.from("verification_tasks").update({ status: "confirmed", resolved_at: new Date().toISOString() }).eq("id", task.id);
      } else if (decision === "reject") {
        // Reject - mark as rejected, keep as Unknown
        await sb.from("verification_tasks").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", task.id);
      } else if (decision === "skip") {
        // Skip - mark with a session ID so it won't appear again in this session
        const skipSessionId = `skip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await sb.from("verification_tasks").update({ status: "skipped", resolved_at: new Date().toISOString(), skip_session_id: `skip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` }).eq("id", task.id);
      }

      processed++;
    }

    return NextResponse.json({ processed });
  } catch (err) {
    console.error("bulk-decide error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}