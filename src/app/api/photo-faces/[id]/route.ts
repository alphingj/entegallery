import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

/**
 * PATCH /api/photo-faces/:id
 * Move a face to another person, or detach it into a brand-new person.
 * Body: { personId } | { newName }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const sb = getSupabaseAdmin();

    // Fetch the face (we need its descriptor when creating a new person).
    const { data: face, error: fetchErr } = await sb
      .from("photo_faces")
      .select("id, person_id, descriptor")
      .eq("id", id)
      .single();
    if (fetchErr || !face) throw new Error(fetchErr?.message ?? "face not found");

    let targetPersonId = body.personId as string | undefined;

    if (!targetPersonId && typeof body.newName === "string" && body.newName.trim()) {
      const descriptor = face.descriptor;
      // pgvector returns the vector as a comma-joined string — convert to array.
      const vec =
        typeof descriptor === "string"
          ? descriptor.split(",").map(Number)
          : (descriptor as number[]);

      const { data: person, error: personErr } = await sb
        .from("people")
        .insert({ name: body.newName.trim(), descriptor: vec })
        .select("id")
        .single();
      if (personErr) throw new Error(personErr.message);
      targetPersonId = person.id as string;
    }

    if (!targetPersonId) {
      return NextResponse.json(
        { error: "personId or newName required" },
        { status: 400 }
      );
    }

    const { error: updateErr } = await sb
      .from("photo_faces")
      .update({ person_id: targetPersonId })
      .eq("id", id);
    if (updateErr) throw new Error(updateErr.message);

    return NextResponse.json({ ok: true, personId: targetPersonId });
  } catch (err) {
    console.error("face move:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}
