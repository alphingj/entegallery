import { NextRequest, NextResponse } from "next/server";
import { BoundingBox, FaceItem, PersonSummary } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

interface FaceJoinRow {
  id: string;
  bounding_box: BoundingBox;
  created_at: string;
  person_id: string;
  photos: {
    google_drive_file_id: string;
    thumbnail_url: string | null;
    file_name: string | null;
  };
}

/**
 * GET /api/people?q=john
 * Lists people (fuzzy name search via pg_trgm when q is present) with a
 * photo count and their most recent face for the crop card.
 */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const q = req.nextUrl.searchParams.get("q")?.trim();

    if (q) {
      const { data: matched, error: searchErr } = await sb.rpc("search_people", {
        query: q,
        result_limit: 30,
      });
      if (searchErr) throw new Error(searchErr.message);
      if (!matched || matched.length === 0) {
        return NextResponse.json({ people: [] });
      }
      return NextResponse.json({
        people: await summarize(
          sb,
          (matched as { id: string; name: string }[]).map((p) => p.id),
          Object.fromEntries((matched as { id: string; name: string }[]).map((p) => [p.id, p.name]))
        ),
      });
    }

    const { data: allPeople, error: peopleErr } = await sb
      .from("people")
      .select("id, name")
      .order("created_at", { ascending: true });
    if (peopleErr) throw new Error(peopleErr.message);

    const people = allPeople as { id: string; name: string }[];
    return NextResponse.json({ people: await summarize(sb, people.map((p) => p.id), Object.fromEntries(people.map((p) => [p.id, p.name]))) });
  } catch (err) {
    console.error("people:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}

async function summarize(
  sb: ReturnType<typeof getSupabaseAdmin>,
  ids: string[],
  names: Record<string, string>
): Promise<PersonSummary[]> {
  if (ids.length === 0) return [];

  // One face per person would suffice for the card, but we need counts too —
  // fetch all faces with embedded photo thumbnails and aggregate in JS.
  const { data, error } = await sb
    .from("photo_faces")
    .select("id, bounding_box, created_at, person_id, photos(google_drive_file_id, thumbnail_url, file_name)")
    .in("person_id", ids)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);

  const byPerson = new Map<string, { count: number; latest: FaceItem | null }>();
  for (const row of data ?? []) {
    const r = row as unknown as FaceJoinRow;
    const entry = byPerson.get(r.person_id) ?? { count: 0, latest: null };
    entry.count += 1;
    if (!entry.latest) {
      entry.latest = {
        faceId: r.id,
        photoId: r.photo_id,
        fileId: r.photos.google_drive_file_id,
        fileName: r.photos.file_name,
        thumbnailUrl: r.photos.thumbnail_url,
        box: r.bounding_box,
        createdAt: r.created_at,
      };
    }
    byPerson.set(r.person_id, entry);
  }

  return ids.map((id) => ({
    id,
    name: names[id] ?? "Unknown",
    photoCount: byPerson.get(id)?.count ?? 0,
    face: byPerson.get(id)?.latest ?? null,
  }));
}
