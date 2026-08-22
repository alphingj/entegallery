"use client";

import { isHeic } from "@/lib/heic";
import {
  detectFaces,
} from "@/lib/face/client";
import {
  fetchWithoutFaces,
  importDrivePage,
  postFaceBackfill,
} from "@/lib/api-client";

/** Phase 1: sync Drive folder metadata into the DB (idempotent, resumable). */
export async function runImportSync(
  includeHeic: boolean,
  onProgress: (imported: number, skipped: number) => void
): Promise<void> {
  let token: string | undefined = undefined;
  let imported = 0;
  let skipped = 0;
  do {
    const page = await importDrivePage(token, includeHeic);
    imported += page.imported;
    skipped += page.skipped;
    onProgress(imported, skipped);
    token = page.nextPageToken ?? undefined;
  } while (token);
}

/** One pending photo's scan job — factored out for parallel execution. */
async function scanOne(photo: {
  id: string;
  google_drive_file_id: string;
  file_name: string | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
}) {
  // Defensive guard — imports already mark these 'unsupported'.
  if (isHeic(photo.mime_type, photo.file_name)) {
    await postFaceBackfill(photo.id, { faces: [] });
    return;
  }
  let blob: Blob;
  try {
    const res = await fetch(
      `https://lh3.googleusercontent.com/d/${photo.google_drive_file_id}=w1600`
    );
    if (!res.ok) throw new Error("cdn fetch failed");
    blob = await res.blob();
  } catch {
    const res = await fetch(`/api/image/${photo.google_drive_file_id}`);
    if (!res.ok) throw new Error(`Could not download ${photo.file_name}`);
    blob = await res.blob();
  }
  const { faces, width, height } = await detectFaces(blob);
  await postFaceBackfill(photo.id, { faces, width, height });
}

/** Phase 2: browser-side face detection for pending photos (idempotent, resumable, pausable, capped). */
export async function runFaceScan(
  onProgress: (done: number, current: string) => void,
  opts: { concurrency?: number; signal?: AbortSignal; limit?: number | null } = {}
): Promise<number> {
  const concurrency = opts.concurrency ?? 3;
  const signal = opts.signal;
  const limit = opts.limit ?? null; // null = all
  let done = 0;
  const CONCURRENCY = Math.max(1, Math.min(concurrency, 6));

  outer: for (;;) {
    if (signal?.aborted) break;
    if (limit !== null && done >= limit) break;
    const remaining = limit !== null ? Math.min(25, limit - done) : 25;
    if (remaining <= 0) break;
    const { photos } = await fetchWithoutFaces(remaining);
    if (photos.length === 0) break;

    for (let i = 0; i < photos.length; i += CONCURRENCY) {
      if (signal?.aborted) break outer;
      if (limit !== null && done >= limit) break outer;
      const batch = photos.slice(i, i + CONCURRENCY);
      // respect limit within batch
      const effectiveBatch =
        limit !== null ? batch.slice(0, limit - done) : batch;
      if (effectiveBatch.length === 0) break outer;
      onProgress(done, effectiveBatch[0]?.file_name ?? "");
      await Promise.all(
        effectiveBatch.map((photo) =>
          scanOne(photo).then(() => {
            done++;
            onProgress(done, "");
          })
        )
      );
      if (signal?.aborted) break outer;
    }
  }
  return done;
}
