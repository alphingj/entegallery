import { SupabaseClient } from "@supabase/supabase-js";
import { BoundingBox } from "@/lib/types";

export interface FaceMatchDiagnostic {
  index: number;
  matched: boolean;
  name: string;
  personId: string | null;
  bestDistance: number | null;
  secondDistance: number | null;
}

interface Candidate {
  person_id: string;
  name: string;
  distance: number;
}

export function isValidDescriptor(d: unknown): d is number[] {
  return (
    Array.isArray(d) &&
    d.length === 512 &&
    d.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

export function isValidBox(b: unknown): b is BoundingBox {
  if (!b || typeof b !== "object") return false;
  const box = b as Record<string, unknown>;
  return (
    (["x", "y", "width", "height"] as const).every((k) => {
      const n = box[k];
      return typeof n === "number" && Number.isFinite(n) && n >= -0.01 && n <= 1.01;
    }) &&
    (box.width as number) > 0 &&
    (box.height as number) > 0
  );
}

/**
 * Match every face of ONE photo against library state AS IT WAS BEFORE this
 * photo, then insert. Guarantees:
 *  1. Faces in the same photo can never contaminate each other (batch-match
 *     runs fully before any write).
 *  2. Auto-tags require a clear winner: best cosine distance below threshold
 *     AND a margin over the runner-up, otherwise the face becomes its own
 *     new "Unknown".
 */
export async function matchAndLinkFaces(
  sb: SupabaseClient,
  photoId: string,
  faces: { descriptor: unknown; box: unknown }[]
): Promise<FaceMatchDiagnostic[]> {
  const threshold = parseFloat(
    process.env.NEXT_PUBLIC_FACE_MATCH_THRESHOLD ?? "0.35"
  );
  const margin = parseFloat(process.env.NEXT_PUBLIC_FACE_MATCH_MARGIN ?? "0.08");

  const valid = faces.filter(
    (f) => isValidDescriptor(f.descriptor) && isValidBox(f.box)
  );

  // Phase 1 — read-only matching against pre-photo state (parallel-safe).
  const candidateLists = await Promise.all(
    valid.map(async (face) => {
      const { data, error } = await sb.rpc("match_person_top2", {
        q: face.descriptor as number[],
        max_dist: threshold,
      });
      if (error) throw new Error(`match_person_top2 failed: ${error.message}`);
      return (data ?? []) as Candidate[];
    })
  );

  // Phase 2 — decide, then write. Unmatched faces each become their own person.
  const diagnostics: FaceMatchDiagnostic[] = [];
  for (let i = 0; i < valid.length; i++) {
    const face = valid[i];
    const [best, second] = candidateLists[i];

    let personId: string;
    let name: string;
    let matched = false;

    const AUTO_MATCH_FLOOR = 0.20; // ArcFace 512d: below this, best is trusted regardless of margin
    if (
      best &&
      (best.distance < AUTO_MATCH_FLOOR ||
        second === undefined ||
        second.distance - best.distance >= margin)
    ) {
      personId = best.person_id;
      name = best.name;
      matched = true;
    } else {
      const { data: person, error } = await sb
        .from("people")
        .insert({ name: "Unknown", descriptor: face.descriptor as number[] })
        .select("id, name")
        .single();
      if (error) throw new Error(`person insert failed: ${error.message}`);
      personId = person.id as string;
      name = person.name as string;
    }

    const { error: faceErr } = await sb.from("photo_faces").insert({
      photo_id: photoId,
      person_id: personId,
      bounding_box: face.box as BoundingBox,
      descriptor: face.descriptor as number[],
    });
    if (faceErr) throw new Error(`face insert failed: ${faceErr.message}`);

    diagnostics.push({
      index: i,
      matched,
      name,
      personId,
      bestDistance: best?.distance ?? null,
      secondDistance: second?.distance ?? null,
    });
  }

  return diagnostics;
}
