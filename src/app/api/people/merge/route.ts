import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

/**
 * POST /api/people/merge
 * Bulk person-level merge for "superb similar" duplicates.
 * Body: { sourceIds: string[], targetId?: string, targetName?: string }
 * - sourceIds: Unknown person ids to merge away
 * - targetId: existing keeper person id (must not be in sourceIds)
 * - targetName: if no targetId, create new keeper with this name from first source's descriptor
 */
export async function POST(req: NextRequest) {
  try {
    const { sourceIds, targetId, targetName } = (await req.json()) as {
      sourceIds: string[];
      targetId?: string;
      targetName?: string;
    };

    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return NextResponse.json({ error: "sourceIds required" }, { status: 400 });
    }
    if (sourceIds.includes(targetId as string)) {
      return NextResponse.json({ error: "targetId cannot be in sourceIds" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();

    let keeperId = targetId ?? null;
    let keeperName: string | null = null;

    if (!keeperId) {
      if (!targetName || !targetName.trim()) {
        return NextResponse.json({ error: "targetId or targetName required" }, { status: 400 });
      }
      // Create keeper from first source's descriptor
      const firstId = sourceIds[0];
      const { data: firstPerson, error: fpErr } = await sb.from("people").select("descriptor").eq("id", firstId).single();
      if (fpErr || !firstPerson) throw new Error(fpErr?.message ?? "source person not found");
      let vec: number[];
      if (typeof firstPerson.descriptor === "string") {
        // Handle potential null/empty values in the descriptor string
        vec = (firstPerson.descriptor as string)
          .split(",")
          .map(s => s.trim())
          .filter(s => s !== "" && s !== "null")
          .map(Number)
          .filter(n => Number.isFinite(n));
      } else {
        vec = (firstPerson.descriptor as number[]).filter(n => Number.isFinite(n));
      }
      // Ensure we have a valid descriptor
      if (vec.length !== 512) {
        throw new Error(`Invalid descriptor dimension: ${vec.length}`);
      }
      const { data: keeper, error: kErr } = await sb.from("people").insert({ name: targetName.trim(), descriptor: vec }).select("id, name").single();
      if (kErr) throw new Error(kErr.message);
      keeperId = keeper.id as string;
      keeperName = keeper.name as string;
    } else {
      const { data: keeper, error: kErr } = await sb.from("people").select("id, name").eq("id", keeperId).single();
      if (kErr || !keeper) throw new Error("keeper not found");
      keeperName = keeper.name as string;
    }

    // Move all faces from source persons to keeper, batched to avoid URL overflow
    const CHUNK = 80;
    let movedFaces = 0;
    for (let i = 0; i < sourceIds.length; i += CHUNK) {
      const chunk = sourceIds.slice(i, i + CHUNK);
      const { data, error } = await sb.from("photo_faces").update({ person_id: keeperId }).in("person_id", chunk).select("id");
      if (error) throw new Error(error.message);
      movedFaces += (data ?? []).length;
    }

    // Delete now-empty source persons
    for (let i = 0; i < sourceIds.length; i += CHUNK) {
      const chunk = sourceIds.slice(i, i + CHUNK);
      const { error } = await sb.from("people").delete().in("id", chunk);
      if (error) throw new Error(error.message);
    }

    // Recompute keeper descriptor as mean of its faces (L2 normalized) for better future matches
    try {
      const { data: faces } = await sb.from("photo_faces").select("descriptor").eq("person_id", keeperId).limit(200);
      if (faces && faces.length > 0) {
        const dim = Array.isArray((faces[0] as { descriptor: unknown }).descriptor)
          ? ((faces[0] as { descriptor: number[] }).descriptor.length as number)
          : typeof (faces[0] as { descriptor: string }).descriptor === "string"
            ? (faces[0] as { descriptor: string }).descriptor.split(",").length
            : 512;
        const sum = new Array(dim).fill(0);
        for (const f of faces as { descriptor: string | number[] }[]) {
          let vec: number[];
          if (typeof f.descriptor === "string") {
            vec = (f.descriptor as string)
              .split(",")
              .map(s => s.trim())
              .filter(s => s !== "" && s !== "null")
              .map(Number)
              .filter(n => Number.isFinite(n));
          } else {
            vec = (f.descriptor as number[]).filter(n => Number.isFinite(n));
          }
          for (let d = 0; d < dim; d++) sum[d] += vec[d] ?? 0;
        }
        for (let d = 0; d < dim; d++) sum[d] /= faces.length;
        const norm = Math.sqrt(sum.reduce((a, v) => a + v * v, 0)) || 1;
        const mean = sum.map((v) => v / norm);
        await sb.from("people").update({ descriptor: mean }).eq("id", keeperId);
      }
    } catch {
      // non-fatal
    }

    return NextResponse.json({ ok: true, keeperId, keeperName, movedFaces, mergedPersons: sourceIds.length });
  } catch (err) {
    console.error("people merge:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "merge failed" }, { status: 500 });
  }
}
