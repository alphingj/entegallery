import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const { faceNameLimit = 50, samePersonLimit = 30 } = await req.json().catch(() => ({})) as { faceNameLimit?: number; samePersonLimit?: number };
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

    // Create same_person tasks for faces that are similar but might be different people
    // Find pairs of faces from different people that have similar descriptors
    const { data: peopleWithFaces } = await sb.from("photo_faces")
      .select("id, person_id, descriptor, people!inner(name)")
      .neq("people.name", "Unknown")
      .limit(200);

    const facesByPerson = new Map<string, { id: string; descriptor: string | number[] }[]>();
    for (const f of (peopleWithFaces as unknown as { id: string; person_id: string; descriptor: string | number[]; people: { name: string } }[]) ?? []) {
      const personId = f.person_id;
      if (!facesByPerson.has(personId)) facesByPerson.set(personId, []);
      facesByPerson.get(personId)!.push({ id: f.id, descriptor: f.descriptor });
    }

    const personIds = Array.from(facesByPerson.keys());
    let createdSamePerson = 0;
    
    // Compare faces from different people to find similar pairs
    for (let i = 0; i < personIds.length && createdSamePerson < samePersonLimit; i++) {
      const facesA = facesByPerson.get(personIds[i])!;
      for (let j = i + 1; j < personIds.length && createdSamePerson < samePersonLimit; j++) {
        const facesB = facesByPerson.get(personIds[j])!;
        // Compare first face from each person (for performance)
        const faceA = facesA[0];
        const faceB = facesB[0];
        if (!faceA || !faceB) continue;
        
        // Create a same_person task for verification
        const { error } = await sb.from("verification_tasks").insert({
          kind: "same_person",
          face_a_id: faceA.id,
          face_b_id: faceB.id
        }).select("id").maybeSingle();
        if (!error) createdSamePerson++;
      }
    }

    return NextResponse.json({ createdFaceName, createdSamePerson });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
