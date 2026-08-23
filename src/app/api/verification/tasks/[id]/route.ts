import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 20;

function parseDescriptor(desc: unknown): number[] | null {
  if (!desc) return null;
  let vec: number[];
  if (typeof desc === "string") {
    vec = desc
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "" && s !== "null")
      .map(Number)
      .filter((n) => Number.isFinite(n));
  } else if (Array.isArray(desc)) {
    vec = (desc as number[]).filter((n) => typeof n === "number" && Number.isFinite(n));
  } else {
    return null;
  }
  return vec.length === 512 ? vec : null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { decision, correctPersonId, newName, skipSessionId } = (await req.json()) as {
      decision: "yes" | "no" | "skip";
      correctPersonId?: string;
      newName?: string;
      skipSessionId?: string;
    };
    const sb = getSupabaseAdmin();
    const { data: task, error: e1 } = await sb.from("verification_tasks").select("*").eq("id", id).single();
    if (e1 || !task) throw new Error("task not found");

    if (decision === "skip") {
      await sb
        .from("verification_tasks")
        .update({
          status: "skipped",
          resolved_at: new Date().toISOString(),
          skip_session_id: skipSessionId ?? `skip_${Date.now()}`,
        })
        .eq("id", id);
      return NextResponse.json({ ok: true });
    }

    if (decision === "yes") {
      if (task.kind === "same_person" && task.face_b_id && task.face_a_id) {
        // Merge person of face_b into person of face_a
        const { data: fa } = await sb.from("photo_faces").select("person_id").eq("id", task.face_a_id).single();
        const { data: fb } = await sb.from("photo_faces").select("person_id").eq("id", task.face_b_id).single();
        if (fa?.person_id && fb?.person_id && fa.person_id !== fb.person_id) {
          await sb.from("photo_faces").update({ person_id: fa.person_id }).eq("person_id", fb.person_id);
          // delete the now-empty person
          await sb.from("people").delete().eq("id", fb.person_id);
          // recompute keeper descriptor as mean of its faces
          try {
            const { data: faces } = await sb.from("photo_faces").select("descriptor").eq("person_id", fa.person_id).limit(200);
            if (faces && faces.length > 0) {
              const vectors = faces.map((f: { descriptor: unknown }) => parseDescriptor(f.descriptor)).filter(Boolean) as number[][];
              if (vectors.length > 0) {
                const dim = 512;
                const sum = new Array(dim).fill(0);
                for (const vec of vectors) for (let d = 0; d < dim; d++) sum[d] += vec[d] ?? 0;
                for (let d = 0; d < dim; d++) sum[d] /= vectors.length;
                const norm = Math.sqrt(sum.reduce((a: number, v: number) => a + v * v, 0)) || 1;
                const mean = sum.map((v: number) => v / norm);
                await sb.from("people").update({ descriptor: mean }).eq("id", fa.person_id);
              }
            }
          } catch {
            /* non-fatal */
          }
        }
      } else if (task.kind === "face_name" && task.face_a_id && task.person_id) {
        // Confirm: link face_a to suggested person
        await sb.from("photo_faces").update({ person_id: task.person_id }).eq("id", task.face_a_id);
      }
      await sb.from("verification_tasks").update({ status: "confirmed", resolved_at: new Date().toISOString() }).eq("id", id);
    } else if (decision === "no") {
      // "No" means the suggestion is wrong — optionally move to correct person or new person
      if (correctPersonId) {
        await sb.from("photo_faces").update({ person_id: correctPersonId }).eq("id", task.face_a_id);
      } else if (newName?.trim()) {
        const { data: face } = await sb.from("photo_faces").select("descriptor").eq("id", task.face_a_id).single();
        const vec = parseDescriptor(face?.descriptor);
        if (vec) {
          const { data: person } = await sb.from("people").insert({ name: newName.trim(), descriptor: vec }).select("id").single();
          if (person) await sb.from("photo_faces").update({ person_id: person.id }).eq("id", task.face_a_id);
        }
      }
      await sb.from("verification_tasks").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", id);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("verification decide:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
