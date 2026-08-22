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

/** Phase 2: browser-side face detection for pending photos (idempotent, resumable). */
export async function runFaceScan(
  onProgress: (done: number, current: string) => void
): Promise<number> {
  let done = 0;
  // Loop until the pending queue is empty.
  for (;;) {
    const { photos } = await fetchWithoutFaces(25);
    if (photos.length === 0) break;

    for (const photo of photos) {
      onProgress(done, photo.file_name ?? photo.google_drive_file_id);

      // Defensive guard — imports already mark these 'unsupported'.
      if (isHeic(photo.mime_type, photo.file_name)) {
        await postFaceBackfill(photo.id, { faces: [] });
        done++;
        onProgress(done, "");
        continue;
      }

      // Fetch bytes straight from Google's public image CDN (files are
      // link-shared) to avoid burning Vercel bandwidth; proxy as fallback.
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
      done++;
      onProgress(done, "");
    }
  }
  return done;
}
