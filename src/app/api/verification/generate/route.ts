import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const { faceNameLimit = 50, samePersonLimit = 30 } = await req.json().catch(() => ({})) as { faceNameLimit?: number; samePersonLimit?: number };

    // Load all known people with descriptors for matching
    const { data: knownPeopleData } = await sb.from("people").select("id, name, descriptor").neq("name", "Unknown");
    const knownPeople = (knownPeopleData as unknown as { id: string; name: string; descriptor: string | number[] }[]) ?? [];

    // Helper to find best match for a descriptor
    function findBestMatch(descriptor: string | number[]): { personId: string; name: string; distance: number } | null {
      if (!knownPeople.length) return null;
      
      const desc = typeof descriptor === "string" 
        ? descriptor.split(",").map(s => s.trim()).filter(s => s !== "" && s !== "null").map(Number)
        : (descriptor as number[]);
      
      let bestMatch: { personId: string; name: string; distance: number } | null = null;
      let bestDist = Infinity;
      
      for (const person of knownPeople) {
        const personDesc = typeof person.descriptor === "string"
          ? person.descriptor.split(",").map(s => s.trim()).filter(s => s !== "" && s !== "null").map(Number)
          : (person.descriptor as number[]);
        
        // Calculate cosine distance
        let sum = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < 512; i++) {
          const a = (desc[i] ?? 0);
          const b = personDesc[i] ?? 0;
          sum += a * b;
          normA += a * a;
          normB += b * b;
        }
        const normAVal = Math.sqrt(normA) || 1;
        const normBVal = Math.sqrt(normB) || 1;
        const dist = 1 - sum / (normAVal * normBVal);
        
        if (dist < bestDist && dist < 0.35) { // threshold
          bestDist = dist;
          bestMatch = { personId: person.id, name: person.name, distance: dist };
        }
      }
      
      return bestMatch;
    }

    // Create face_name tasks for Unknown faces that have no pending task yet
    const { data: pendingIds } = await sb.from("verification_tasks").select("face_a_id").eq("status", "pending").eq("kind", "face_name");
    const pendingSet = new Set((pendingIds ?? []).map((r: { face_a_id: string }) => r.face_a_id));
    const { data: unknowns } = await sb.from("photo_faces").select("id, descriptor").eq("people.name", "Unknown").limit(300);
    
    let createdFaceName = 0;
    for (const f of (unknowns as unknown as { id: string; descriptor: string | number[] }[]) ?? []) {
      if (pendingSet.has(f.id)) continue;
      if (createdFaceName >= faceNameLimit) break;
      
      const match = findBestMatch(f.descriptor);
      if (!match) continue;
      
      const { error } = await sb.from("verification_tasks").insert({ 
        kind: "face_name", 
        face_a_id: f.id,
        person_id: match.personId,
        best_distance: match.distance
      }).select("id").maybeSingle();
      if (!error) createdFaceName++;
    }

    // Create same_person tasks for faces that are similar but might be different people
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
        const faceA = facesA[0];
        const faceB = facesB[0];
        if (!faceA || !faceB) continue;
        
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