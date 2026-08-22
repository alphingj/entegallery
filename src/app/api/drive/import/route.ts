import { NextRequest, NextResponse } from "next/server";
import {
  DriveError,
  driveThumbnailUrl,
  listFolderImages,
  setLinkShared,
  type DriveImageItem,
} from "@/lib/google-drive";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

/** Run promise-returning tasks with bounded concurrency. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<unknown>
): Promise<void> {
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    }
  );
  await Promise.all(workers);
}

/**
 * Imports one page of existing Drive folder images into the DB.
 * Idempotent: re-run freely; already-indexed files are skipped.
 * The client loops with the returned nextPageToken until it is null.
 */
export async function POST(req: NextRequest) {
  try {
    const { pageToken } = (await req.json().catch(() => ({}))) as {
      pageToken?: string;
    };
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) throw new DriveError("GOOGLE_DRIVE_FOLDER_ID missing.", 500);

    const { files, nextPageToken } = await listFolderImages(folderId, pageToken);
    const sb = getSupabaseAdmin();

    // Which of these are already indexed?
    const existing = new Set<string>();
    for (let i = 0; i < files.length; i += 100) {
      const chunk = files.slice(i, i + 100);
      const { data, error } = await sb
        .from("photos")
        .select("google_drive_file_id")
        .in("google_drive_file_id", chunk.map((f) => f.id));
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        existing.add((row as { google_drive_file_id: string }).google_drive_file_id);
      }
    }

    const fresh = files.filter((f) => !existing.has(f.id));

    // Insert metadata rows, preserving the file's original created date.
    if (fresh.length > 0) {
      const rows = fresh.map((f) => ({
        google_drive_file_id: f.id,
        file_name: f.name,
        mime_type: f.mimeType,
        byte_size: f.size ? Number(f.size) : null,
        width: f.imageMediaMetadata?.width ?? null,
        height: f.imageMediaMetadata?.height ?? null,
        thumbnail_url: driveThumbnailUrl(f.id),
        ...(f.createdTime ? { created_at: f.createdTime } : {}),
      }));
      const { error } = await sb
        .from("photos")
        .upsert(rows, {
          onConflict: "google_drive_file_id",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(`import insert failed: ${error.message}`);
    }

    // Grant link-share so thumbnails render. Also covers previously-imported
    // files whose permission grant may have been missed. Non-fatal on failure.
    await mapWithConcurrency(files, 8, (f: DriveImageItem) => setLinkShared(f.id));

    return NextResponse.json({
      found: files.length,
      imported: fresh.length,
      skipped: files.length - fresh.length,
      nextPageToken,
    });
  } catch (err) {
    const status = err instanceof DriveError ? err.status : 500;
    console.error("drive/import:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "import failed" },
      { status }
    );
  }
}
