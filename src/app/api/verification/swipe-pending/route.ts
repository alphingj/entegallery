import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const skipSessionId = req.nextUrl.searchParams.get("skipSessionId");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20, 100);

    let q = getSupabaseAdmin()
      .from("verification_tasks")
      .select(
        `*, face_a:photo_faces!verification_tasks_face_a_id_fkey(id,bounding_box,photo_id,photos!inner(thumbnail_url,file_name,google_drive_file_id,width,height)), person:people!verification_tasks_person_id_fkey(id,name)`
      )
      .eq("status", "pending")
      .eq("kind", "face_name")
      .not("person_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    // Filter out tasks that have been skipped in this session
    if (skipSessionId) {
      q = q.neq("skip_session_id", skipSessionId);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // Group tasks by person_id
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