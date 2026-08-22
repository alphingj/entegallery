import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100, 500);

    // Get all Unknown faces that don't have a pending verification task
    const { data: unknownFaces, error: facesError } = await sb
      .from("photo_faces")
      .select(
        `id, 
         person_id, 
         descriptor, 
         bounding_box, 
         photo_id, 
         photos!inner(
           google_drive_file_id, 
           thumbnail_url, 
           file_name, 
           width, 
           height
         )`
      )
      .eq("people.name", "Unknown")
      .limit(500);

    if (facesError) throw new Error(facesError.message);

    // Get all pending face_name tasks to exclude already tasked faces
    const { data: pendingIds } = await sb
      .from("verification_tasks")
      .select("face_a_id")
      .eq("status", "pending")
      .eq("kind", "face_name");

    const pendingSet = new Set(
      (pendingIds ?? []).map((r: { face_a_id: string }) => r.face_a_id)
    );

    // Get all known people with descriptors for matching
    const { data: knownPeopleData } = await sb
      .from("people")
      .select("id, name, descriptor")
      .neq("name", "Unknown");

    const knownPeople = ((knownPeopleData ?? []) as unknown as { id: string; name: string; descriptor: string | number[] }[]);

    // Filter out faces that already have pending tasks
    const unknownFacesFiltered = (unknownFaces as unknown as { 
      id: string; 
      descriptor: string | number[]; 
      bounding_box: { x: number; y: number; width: number; height: number };
      photo_id: string;
      photos: {
        google_drive_file_id: string;
        thumbnail_url: string | null;
        file_name: string | null;
        width: number | null;
        height: number | null;
      }
    }[]).filter((f) => !pendingSet.has(f.id));

    // For each unknown face, find the best matching known person
    const faceGroups = new Map<string, { 
      personId: string | null; 
      personName: string; 
      faceCount: number;
      faces: Array<{
        faceId: string;
        boundingBox: { x: number; y: number; width: number; height: number };
        photoId: string;
        thumbnailUrl: string | null;
        fileName: string | null;
        googleDriveFileId: string;
        width: number | null;
        height: number | null;
      }>;
    }>();

    // Helper to parse descriptor
    function parseDescriptor(desc: string | number[]): number[] {
      if (Array.isArray(desc)) return desc as number[];
      return (desc as string)
        .split(",")
        .map(s => s.trim())
        .filter(s => s !== "" && s !== "null")
        .map(Number);
    }

    // For each unknown face, find the best matching known person
    for (const face of unknownFacesFiltered) {
      const faceDesc = typeof face.descriptor === "string" 
        ? face.descriptor.split(",").map(s => s.trim()).filter(s => s !== "" && s !== "null").map(Number)
        : face.descriptor as number[];

      let bestMatch: { personId: string; name: string; distance: number } | null = null;
      let bestDist = Infinity;

      for (const person of knownPeople) {
        const personDesc = typeof person.descriptor === "string"
          ? person.descriptor.split(",").map(s => s.trim()).filter(s => s !== "" && s !== "null").map(Number)
          : person.descriptor as number[];

        // Calculate cosine distance
        let sum = 0, normA = 0, normB = 0;
        for (let i = 0; i < 512; i++) {
          const a = faceDesc[i] ?? 0;
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

      const personKey = bestMatch ? bestMatch.personId : `new_${Math.random().toString(36).substr(2, 9)}`;
      const personName = bestMatch ? bestMatch.name : "New Person";

      if (!faceGroups.has(personKey)) {
        faceGroups.set(personKey, {
          personId: bestMatch?.personId || null,
          personName: bestMatch?.name || "New Person",
          faceCount: 0,
          faces: []
        });
      }

      const group = faceGroups.get(personKey)!;
      group.faceCount++;
      group.faces.push({
        faceId: face.id,
        boundingBox: face.bounding_box,
        photoId: face.photo_id,
        thumbnailUrl: face.photos?.thumbnail_url ?? null,
        fileName: face.photos?.file_name ?? null,
        googleDriveFileId: face.photos?.google_drive_file_id ?? "",
        width: face.photos?.width ?? null,
        height: face.photos?.height ?? null,
      });
    }

    // Convert to array and sort by face count descending
    const resultGroups = Array.from(faceGroups.entries()).map(([personId, group]) => ({
      personId: group.personId,
      personName: group.personName,
      faceCount: group.faceCount,
      faces: group.faces,
    })).sort((a, b) => b.faceCount - a.faceCount);

    return NextResponse.json({ groups: resultGroups });
  } catch (err) {
    console.error("bulk-pending error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}