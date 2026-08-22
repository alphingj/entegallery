import { NextRequest, NextResponse } from "next/server";
import {
  DriveError,
  listFolderImages,
} from "@/lib/google-drive";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

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
 * POST /api/photos/find-duplicates?pageToken=
 * Scans Drive folder for md5Checksum, updates DB, returns duplicate groups.
 * Idempotent: re-run to continue. Returns nextPageToken to continue.
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

    // Upsert md5 checksums for all listed files (batch)
    const freshMappings: { google_drive_file_id: string; md5_checksum: string }[] =
      [];
    for (const f of files) {
      if (f.md5Checksum) {
        freshMappings.push({
          google_drive_file_id: f.id,
          md5_checksum: f.md5Checksum,
        });
      }
    }
    // Store md5 checksums via targeted updates (never upsert — a partial-row
    // upsert would null out unrelated columns).
    let updated = 0;
    if (freshMappings.length > 0) {
      for (let i = 0; i < freshMappings.length; i += 100) {
        const chunk = freshMappings.slice(i, i + 100);
        const { data: rows, error: selErr } = await sb
          .from("photos")
          .select("id, google_drive_file_id")
          .in(
            "google_drive_file_id",
            chunk.map((m) => m.google_drive_file_id)
          );
        if (selErr) throw new Error(selErr.message);

        const idByDriveId = new Map<string, string>();
        for (const row of rows ?? []) {
          const r = row as { id: string; google_drive_file_id: string };
          idByDriveId.set(r.google_drive_file_id, r.id);
        }

        await mapWithConcurrency(chunk, 8, async (m) => {
          const pid = idByDriveId.get(m.google_drive_file_id);
          if (!pid) return; // not indexed in our DB (e.g., HEIC skipped) — nothing to tag
          const { error } = await sb
            .from("photos")
            .update({ md5_checksum: m.md5_checksum })
            .eq("id", pid);
          if (error) throw new Error(`md5 update failed: ${error.message}`);
        });
      }
      updated = freshMappings.length;
    }

    // Find duplicate groups in DB (same md5, different drive ids)
    const { data: dupesRaw, error: groupErr } = await sb
      .from("photos")
      .select(
        "google_drive_file_id, md5_checksum, id, file_name, thumbnail_url, byte_size, created_at"
      )
      .not("md5_checksum", "is", null);

    if (groupErr) throw new Error(groupErr.message);

    const byMd5 = new Map<
      string,
      { id: string; file_name: string | null; thumbnail_url: string | null; byte_size: number | null; created_at: string }[]
    >();
    for (const row of dupesRaw ?? []) {
      const r = row as {
        md5_checksum: string;
        id: string;
        file_name: string | null;
        thumbnail_url: string | null;
        byte_size: number | null;
        created_at: string;
      };
      if (!r.md5_checksum) continue;
      const arr = byMd5.get(r.md5_checksum) ?? [];
      arr.push(r);
      byMd5.set(r.md5_checksum, arr);
    }

    const groups = Array.from(byMd5.entries())
      .filter(([, items]) => items.length > 1)
      .map(([md5, items]) => ({ md5, items }));

    return NextResponse.json({
      updated,
      nextPageToken,
      groups,
    });
  } catch (err) {
    const status = err instanceof DriveError ? err.status : 500;
    console.error("find-duplicates:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status }
    );
  }
}