import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseDescriptor } from "@/lib/cosine";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const { decisions } = (await req.json()) as {
      decisions: Array<{ faceId: string; decision: "confirm" | "reject" | "skip"; correctPersonId?: string; newName?: string }>;
    };

    if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
      return NextResponse.json({ error: "decisions array required" }, { status: 400 });
    }

    // For bulk "confirm" with newName, we need to create a person once and reuse it for all faces in that batch.
    // Group by newName so all faces with same newName go to same new person.
    const newNameToPersonId = new Map<string, string>();

    let processed = 0;
    for (const item of decisions) {
      const { faceId, decision, correctPersonId, newName } = item;
      if (!faceId || !["confirm", "reject", "skip"].includes(decision)) continue;

      // Try to find a pending verification task for this face (if exists, update it; if not, operate directly on photo_faces)
      const { data: task } = await sb
        .from("verification_tasks")
        .select("id, kind, face_a_id, face_b_id, person_id")
        .eq("face_a_id", faceId)
        .eq("status", "pending")
        .maybeSingle();

      if (decision === "confirm") {
        let targetPersonId: string | null = null;

        if (correctPersonId) {
          targetPersonId = correctPersonId;
        } else if (newName?.trim()) {
          const key = newName.trim().toLowerCase();
          if (newNameToPersonId.has(key)) {
            targetPersonId = newNameToPersonId.get(key)!;
          } else {
            // Create new person from this face's descriptor
            const { data: face } = await sb.from("photo_faces").select("descriptor").eq("id", faceId).single();
            const vec = parseDescriptor(face?.descriptor);
            if (!vec) continue;
            const { data: person, error } = await sb.from("people").insert({ name: newName.trim(), descriptor: vec }).select("id").single();
            if (error || !person) continue;
            targetPersonId = person.id as string;
            newNameToPersonId.set(key, targetPersonId);
          }
        } else if (task?.person_id) {
          targetPersonId = task.person_id as string;
        }

        if (targetPersonId) {
          await sb.from("photo_faces").update({ person_id: targetPersonId }).eq("id", faceId);
        }

        if (task) {
          await sb.from("verification_tasks").update({ status: "confirmed", resolved_at: new Date().toISOString() }).eq("id", task.id);
        }
      } else if (decision === "reject") {
        if (task) {
          await sb.from("verification_tasks").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", task.id);
        }
        // No photo_faces change — keep as Unknown
      } else if (decision === "skip") {
        if (task) {
          await sb
            .from("verification_tasks")
            .update({ status: "skipped", resolved_at: new Date().toISOString(), skip_session_id: `skip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}` })
            .eq("id", task.id);
        }
        // For bulk faces with no task, skip is a no-op (they'll just be filtered next time if we wanted, but they weren't tasked anyway)
      }

      processed++;
    }

    return NextResponse.json({ ok: true, processed });
  } catch (err) {
    console.error("bulk-decide error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
