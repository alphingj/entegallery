import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const skipSessionId = req.nextUrl.searchParams.get("skipSessionId");
    const kind = req.nextUrl.searchParams.get("kind") ?? "face_name";
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20, 100);

    // For same_person, person_id is null and we need face_b as well
    const isSamePerson = kind === "same_person";
    const select = isSamePerson
      ? `*, face_a:photo_faces!verification_tasks_face_a_id_fkey(id,bounding_box,photo_id,photos!inner(thumbnail_url,file_name,google_drive_file_id,width,height)), face_b:photo_faces!verification_tasks_face_b_id_fkey(id,bounding_box,photo_id,photos!inner(thumbnail_url,file_name,google_drive_file_id,width,height))`
      : `*, face_a:photo_faces!verification_tasks_face_a_id_fkey(id,bounding_box,photo_id,photos!inner(thumbnail_url,file_name,google_drive_file_id,width,height)), person:people!verification_tasks_person_id_fkey(id,name)`;

    let q = getSupabaseAdmin()
      .from("verification_tasks")
      .select(select)
      .eq("status", "pending")
      .eq("kind", kind)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (!isSamePerson) {
      // face_name tasks must have a suggested person
      q = q.not("person_id", "is", null);
    }

    // Filter out tasks that have been skipped in this session
    if (skipSessionId) {
      q = q.neq("skip_session_id", skipSessionId);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    if (isSamePerson) {
      // same_person: each task is a pair (A vs B) — return one "person" per task for the swipe UI to render as pair
      const spTasks = (data ?? []) as Array<{
        id: string;
        face_a_id: string;
        face_b_id: string;
        best_distance: number | null;
        face_a: {
          id: string;
          bounding_box: { x: number; y: number; width: number; height: number };
          photo_id: string;
          photos: { google_drive_file_id: string; thumbnail_url: string | null; file_name: string | null; width: number | null; height: number | null };
        };
        face_b: {
          id: string;
          bounding_box: { x: number; y: number; width: number; height: number };
          photo_id: string;
          photos: { google_drive_file_id: string; thumbnail_url: string | null; file_name: string | null; width: number | null; height: number | null };
        };
      }>;

      type SwipeTaskPair = {
        taskId: string;
        faceId: string;
        boundingBox: { x: number; y: number; width: number; height: number };
        photoId: string;
        thumbnailUrl: string | null;
        fileName: string | null;
        googleDriveFileId: string;
        bestDistance: number | null;
        width: number | null;
        height: number | null;
        pairFaceId?: string;
        pairBoundingBox?: { x: number; y: number; width: number; height: number };
        pairThumbnailUrl?: string | null;
      };

      const people: Array<{ personId: string; personName: string; faceCount: number; tasks: SwipeTaskPair[] }> = spTasks.map((t) => ({
        personId: t.id,
        personName: "Pair",
        faceCount: 1,
        tasks: [
          {
            taskId: t.id,
            faceId: t.face_a_id,
            boundingBox: t.face_a.bounding_box,
            photoId: t.face_a.photo_id,
            thumbnailUrl: t.face_a.photos?.thumbnail_url ?? null,
            fileName: t.face_a.photos?.file_name ?? null,
            googleDriveFileId: t.face_a.photos?.google_drive_file_id,
            bestDistance: t.best_distance,
            width: t.face_a.photos?.width ?? null,
            height: t.face_a.photos?.height ?? null,
            pairFaceId: t.face_b.id,
            pairBoundingBox: t.face_b.bounding_box,
            pairThumbnailUrl: t.face_b.photos?.thumbnail_url ?? null,
          },
        ],
      }));
      return NextResponse.json({ people });
    }

    // face_name: Group tasks by person_id
    const tasks = (data ?? []) as Array<{
      id: string;
      face_a_id: string;
      person_id: string;
      best_distance: number | null;
      face_a: {
        id: string;
        bounding_box: { x: number; y: number; width: number; height: number };
        photo_id: string;
        photos: {
          google_drive_file_id: string;
          thumbnail_url: string | null;
          file_name: string | null;
          width: number | null;
          height: number | null;
        };
      };
      person: { id: string; name: string };
    }>;

    interface SwipeTask {
        taskId: string;
        faceId: string;
        boundingBox: { x: number; y: number; width: number; height: number };
        photoId: string;
        thumbnailUrl: string | null;
        fileName: string | null;
        googleDriveFileId: string;
        bestDistance: number | null;
        width: number | null;
        height: number | null;
      }
    
    const groups = new Map<string, { personId: string; personName: string; faceCount: number; tasks: SwipeTask[] }>();
    
    for (const task of tasks) {
      if (!task.person) continue;
      const personId = task.person.id;
      if (!groups.has(personId)) {
        groups.set(personId, {
          personId: personId,
          personName: task.person.name,
          faceCount: 0,
          tasks: []
        });
      }
      const group = groups.get(personId)!;
      group.tasks.push({
        taskId: task.id,
        faceId: task.face_a_id,
        boundingBox: task.face_a.bounding_box,
        photoId: task.face_a.photo_id,
        thumbnailUrl: task.face_a.photos?.thumbnail_url ?? null,
        fileName: task.face_a.photos?.file_name ?? null,
        googleDriveFileId: task.face_a.photos?.google_drive_file_id,
        bestDistance: task.best_distance,
        width: task.face_a.photos?.width ?? null,
        height: task.face_a.photos?.height ?? null,
      });
      group.faceCount++;
    }

    const people = Array.from(groups.values()).map(g => ({
      personId: g.personId,
      personName: g.personName,
      faceCount: g.tasks.length,
      tasks: g.tasks
    }));

    return NextResponse.json({ people });
  } catch (err) {
    console.error("swipe-pending error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}