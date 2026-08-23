import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

function parseVec(desc: unknown): number[] | null {
  if (!desc) return null;
  let v: number[];
  if (typeof desc === "string") {
    v = desc.split(",").map((s) => s.trim()).filter((s) => s !== "" && s !== "null").map(Number).filter((n) => Number.isFinite(n));
  } else if (Array.isArray(desc)) {
    v = (desc as number[]).filter((n) => typeof n === "number" && Number.isFinite(n));
  } else return null;
  return v.length === 512 ? v : null;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 512; i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    dot += av * bv; na += av * av; nb += bv * bv;
  }
  return 1 - dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const { faceNameLimit = 50, samePersonLimit = 30 } = await req.json().catch(() => ({})) as { faceNameLimit?: number; samePersonLimit?: number };

    // 1) Load known people (name != Unknown) with descriptors
    const { data: knownPeopleData } = await sb.from("people").select("id, name, descriptor").neq("name", "Unknown");
    const knownPeople = (knownPeopleData as unknown as { id: string; name: string; descriptor: unknown }[] | null) ?? [];
    const knownVecs = knownPeople.map((p) => ({ id: p.id, name: p.name, vec: parseVec(p.descriptor) })).filter((p) => p.vec) as { id: string; name: string; vec: number[] }[];

    function findBestMatch(descriptor: unknown): { personId: string; name: string; distance: number } | null {
      const vec = parseVec(descriptor);
      if (!vec || knownVecs.length === 0) return null;
      let best: { personId: string; name: string; distance: number } | null = null;
      let bestDist = Infinity;
      for (const kp of knownVecs) {
        const d = cosineDistance(vec, kp.vec);
        if (d < bestDist && d < 0.35) { bestDist = d; best = { personId: kp.id, name: kp.name, distance: d }; }
      }
      return best;
    }

    // 2) Unknown faces that have no pending face_name task yet
    const { data: pendingIds } = await sb.from("verification_tasks").select("face_a_id").eq("status", "pending").eq("kind", "face_name");
    const pendingSet = new Set((pendingIds ?? []).map((r: { face_a_id: string }) => r.face_a_id).filter(Boolean));

    // Get Unknown person ids first, then their faces (avoids join filter issue)
    const { data: unknownPeople } = await sb.from("people").select("id").eq("name", "Unknown").limit(5000);
    const unknownPids = (unknownPeople ?? []).map((p: { id: string }) => p.id);
    let unknowns: { id: string; descriptor: unknown }[] = [];
    if (unknownPids.length > 0) {
      // chunk to avoid URL length limit
      for (let i = 0; i < unknownPids.length; i += 80) {
        const chunk = unknownPids.slice(i, i + 80);
        const { data } = await sb.from("photo_faces").select("id, descriptor").in("person_id", chunk).limit(500);
        if (data) unknowns.push(...(data as { id: string; descriptor: unknown }[]));
        if (unknowns.length >= 300) { unknowns = unknowns.slice(0, 300); break; }
      }
    }

    let createdFaceName = 0;
    for (const f of unknowns) {
      if (pendingSet.has(f.id)) continue;
      if (createdFaceName >= faceNameLimit) break;
      const match = findBestMatch(f.descriptor);
      if (!match) continue;
      const { error } = await sb.from("verification_tasks").insert({
        kind: "face_name",
        face_a_id: f.id,
        person_id: match.personId,
        best_distance: match.distance,
      }).select("id").maybeSingle();
      if (!error) createdFaceName++;
    }

    // 3) same_person tasks: pairs of faces from different known people that are suspiciously close
    // Only generate if we have at least 2 known people
    let createdSamePerson = 0;
    if (knownVecs.length >= 2) {
      // check existing pending same_person pairs to avoid duplicates
      const { data: existingPairs } = await sb.from("verification_tasks").select("face_a_id, face_b_id").eq("status", "pending").eq("kind", "same_person");
      const pairSet = new Set((existingPairs ?? []).map((r: { face_a_id: string; face_b_id: string }) => `${r.face_a_id}:${r.face_b_id}`));

      // load up to 200 faces from known people (one per person is enough for the cross-product)
      const facesByPerson = new Map<string, { id: string; vec: number[] }[]>();
      for (const kp of knownVecs) {
        // already have vectors, but need face ids — fetch one representative face per person
        const { data: faces } = await sb.from("photo_faces").select("id, descriptor").eq("person_id", kp.id).limit(3);
        const vecs = (faces ?? []).map((f: { id: string; descriptor: unknown }) => ({ id: f.id, vec: parseVec(f.descriptor) })).filter((x) => x.vec) as { id: string; vec: number[] }[];
        if (vecs.length) facesByPerson.set(kp.id, vecs);
      }

      const personIds = Array.from(facesByPerson.keys());
      outer: for (let i = 0; i < personIds.length; i++) {
        for (let j = i + 1; j < personIds.length; j++) {
          if (createdSamePerson >= samePersonLimit) break outer;
          const a = facesByPerson.get(personIds[i])?.[0];
          const b = facesByPerson.get(personIds[j])?.[0];
          if (!a || !b) continue;
          const key = `${a.id}:${b.id}`;
          const rev = `${b.id}:${a.id}`;
          if (pairSet.has(key) || pairSet.has(rev)) continue;
          // only create if they are actually similar (distance < 0.45) — avoids random pairs
          const d = cosineDistance(a.vec, b.vec);
          if (d > 0.45) continue;
          const { error } = await sb.from("verification_tasks").insert({
            kind: "same_person",
            face_a_id: a.id,
            face_b_id: b.id,
            best_distance: d,
          }).select("id").maybeSingle();
          if (!error) { createdSamePerson++; pairSet.add(key); }
        }
      }
    }

    return NextResponse.json({ createdFaceName, createdSamePerson });
  } catch (err) {
    console.error("verification generate:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
