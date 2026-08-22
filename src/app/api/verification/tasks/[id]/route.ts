import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 20;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { decision, correctPersonId, newName } = await req.json() as { decision: "yes"|"no"; correctPersonId?: string; newName?: string };
    const sb = getSupabaseAdmin();
    const { data: task, error: e1 } = await sb.from("verification_tasks").select("*").eq("id", id).single();
    if (e1 || !task) throw new Error("task not found");
    if (decision === "yes") {
      if (task.kind === "same_person" && task.face_b_id) {
        const { data: fb } = await sb.from("photo_faces").select("person_id").eq("id", task.face_b_id).single();
        if (fb) {
          await sb.from("photo_faces").update({ person_id: (task as unknown as { face_a_id: string }).face_a_id ? (await sb.from("photo_faces").select("person_id").eq("id", task.face_a_id).single()).data?.person_id : fb.person_id }).eq("person_id", fb.person_id);
        }
      }
      await sb.from("verification_tasks").update({ status: "confirmed", resolved_at: new Date().toISOString() }).eq("id", id);
    } else {
      // no: optionally move to correct person or new Unknown
      if (correctPersonId) {
        await sb.from("photo_faces").update({ person_id: correctPersonId }).eq("id", task.face_a_id);
      } else if (newName) {
        const { data: face } = await sb.from("photo_faces").select("descriptor").eq("id", task.face_a_id).single();
        const vec = typeof face?.descriptor === "string" ? (face.descriptor as string).split(",").map(Number) : face?.descriptor as number[];
        const { data: person } = await sb.from("people").insert({ name: newName, descriptor: vec }).select("id").single();
        if (person) await sb.from("photo_faces").update({ person_id: person.id }).eq("id", task.face_a_id);
      }
      await sb.from("verification_tasks").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
