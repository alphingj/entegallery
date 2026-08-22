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

/** Phase 2: browser-side face detection for pending photos (idempotent, resumable). */
export async function runFaceScan(
  onProgress: (done: number, current: string) => void,
  concurrency = 3
): Promise<number> {
  let done = 0;
  // Prioritize accuracy (SSD/1920) — concurrency gives the speed without shrinking the model.
  const CONCURRENCY = Math.max(1, Math.min(concurrency, 6));

  for (;;) {
    const { photos } = await fetchWithoutFaces(25);
    if (photos.length === 0) break;

    // Process this page with bounded parallelism — keeps GPU fed and shows real utilization.
    for (let i = 0; i < photos.length; i += CONCURRENCY) {
      const batch = photos.slice(i, i + CONCURRENCY);
      onProgress(done, batch[0]?.file_name ?? "");
      await Promise.all(
        batch.map((photo) =>
          scanOne(photo).then(() => {
            done++;
            onProgress(done, "");
          })
        )
      );
    }
  }
  return done;
}
