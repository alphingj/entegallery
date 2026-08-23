import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { cosineDistance, parseDescriptor } from "@/lib/cosine";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100, 500);

    // 1) Get Unknown person ids, then their faces (avoids broken join filter)
    const { data: unknownPeople } = await sb.from("people").select("id").eq("name", "Unknown").limit(5000);
    const unknownPids = (unknownPeople ?? []).map((p: { id: string }) => p.id);
    if (unknownPids.length === 0) return NextResponse.json({ groups: [] });

    // Chunk to avoid URL length limit
    const unknownFaces: {
      id: string;
      descriptor: unknown;
      bounding_box: { x: number; y: number; width: number; height: number };
      photo_id: string;
      photos: {
        google_drive_file_id: string;
        thumbnail_url: string | null;
        file_name: string | null;
        width: number | null;
        height: number | null;
        mime_type?: string | null;
      } | null;
    }[] = [];

    for (let i = 0; i < unknownPids.length; i += 80) {
      const chunk = unknownPids.slice(i, i + 80);
      const { data, error } = await sb
        .from("photo_faces")
        .select(
          `id, descriptor, bounding_box, photo_id, photos!inner(google_drive_file_id, thumbnail_url, file_name, width, height, mime_type)`
        )
        .in("person_id", chunk)
        .limit(500);
      if (error) throw new Error(error.message);
      if (data) unknownFaces.push(...(data as unknown as typeof unknownFaces));
      if (unknownFaces.length >= 500) break;
    }

    // Filter out HEIC (can't be verified in bulk view reliably, but include for now — thumbnail via CDN still works)
    // Actually keep all, frontend handles HEIC via thumbnail CDN.

    // Exclude faces already in a pending verification task
    const { data: pendingIds } = await sb
      .from("verification_tasks")
      .select("face_a_id")
      .eq("status", "pending")
      .eq("kind", "face_name");
    const pendingSet = new Set((pendingIds ?? []).map((r: { face_a_id: string }) => r.face_a_id).filter(Boolean));
    const filtered = unknownFaces.filter((f) => !pendingSet.has(f.id)).slice(0, limit);

    if (filtered.length === 0) return NextResponse.json({ groups: [] });

    // Load known people with descriptors
    const { data: knownPeopleData } = await sb.from("people").select("id, name, descriptor").neq("name", "Unknown");
    const knownPeople = ((knownPeopleData ?? []) as unknown as { id: string; name: string; descriptor: unknown }[])
      .map((p) => ({ id: p.id, name: p.name, vec: parseDescriptor(p.descriptor) }))
      .filter((p) => p.vec) as { id: string; name: string; vec: number[] }[];

    // Group by best match; unmatched go to single "New Person" group
    type FaceOut = {
      faceId: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      photoId: string;
      thumbnailUrl: string | null;
      fileName: string | null;
      googleDriveFileId: string;
      width: number | null;
      height: number | null;
    };

    const groups = new Map<string, { personId: string | null; personName: string; faceCount: number; faces: FaceOut[]; representativeFace: FaceOut | null }>();

    for (const face of filtered) {
      const vec = parseDescriptor(face.descriptor);
      let best: { id: string; name: string; dist: number } | null = null;
      if (vec && knownPeople.length) {
        let bestDist = Infinity;
        for (const kp of knownPeople) {
          const d = cosineDistance(vec, kp.vec);
          if (d < bestDist && d < 0.35) { bestDist = d; best = { id: kp.id, name: kp.name, dist: bestDist }; }
        }
      }
      const key = best ? best.id : "__new__";
      const name = best ? best.name : "New Person";
      if (!groups.has(key)) {
        groups.set(key, { personId: best?.id ?? null, personName: name, faceCount: 0, faces: [], representativeFace: null });
      }
      const g = groups.get(key)!;
      const out: FaceOut = {
        faceId: face.id,
        boundingBox: face.bounding_box,
        photoId: face.photo_id,
        thumbnailUrl: face.photos?.thumbnail_url ?? null,
        fileName: face.photos?.file_name ?? null,
        googleDriveFileId: face.photos?.google_drive_file_id ?? "",
        width: face.photos?.width ?? null,
        height: face.photos?.height ?? null,
      };
      g.faces.push(out);
      g.faceCount++;
      if (!g.representativeFace) g.representativeFace = out;
    }

    const result = Array.from(groups.values())
      .map((g) => ({
        personId: g.personId,
        personName: g.personName,
        faceCount: g.faceCount,
        representativeFace: g.representativeFace!,
        faces: g.faces,
      }))
      .sort((a, b) => b.faceCount - a.faceCount);

    return NextResponse.json({ groups: result });
  } catch (err) {
    console.error("bulk-pending error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
