"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  detectFaces,
} from "@/lib/face/client";
import {
  fetchWithoutFaces,
  importDrivePage,
  postFaceBackfill,
} from "@/lib/api-client";

type Phase = "idle" | "syncing" | "scanning" | "done";

/**
 * Two-phase import of an existing Drive library:
 *   1. syncing — server pages through the folder, indexing metadata + thumbnails
 *   2. scanning — browser downloads unscanned photos from Google's CDN,
 *      detects faces locally, and posts descriptors for matching
 */
export function ImportDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [synced, setSynced] = useState({ imported: 0, skipped: 0 });
  const [scanProgress, setScanProgress] = useState({ done: 0, current: "" });
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      // ---- phase 1: metadata sync ----
      setPhase("syncing");
      let pageToken: string | undefined = undefined;
      let imported = 0;
      let skipped = 0;
      do {
        const page = await importDrivePage(pageToken);
        imported += page.imported;
        skipped += page.skipped;
        setSynced({ imported, skipped });
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken);

      // ---- phase 2: face backfill in-browser ----
      setPhase("scanning");
      let done = 0;
      // Loop until a query returns nothing new (imports may add more each pass).
      for (;;) {
        const { photos } = await fetchWithoutFaces(25);
        if (photos.length === 0) break;

        for (const photo of photos) {
          setScanProgress({
            done,
            current: photo.file_name ?? photo.google_drive_file_id,
          });

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
          setScanProgress((p) => ({ ...p, done }));
        }

        await queryClient.invalidateQueries({ queryKey: ["people"] });
        await queryClient.invalidateQueries({ queryKey: ["photos"] });
      }

      await queryClient.invalidateQueries({ queryKey: ["photos"] });
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      setPhase("done");
      toast.success(`Imported ${imported} photos · scanned ${done} for faces`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  const busy = phase === "syncing" || phase === "scanning";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <CloudDownload className="size-4" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import existing Drive photos</DialogTitle>
          <DialogDescription>
            Indexes everything already in your Drive folder, then scans it for
            faces right here in your browser.
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Existing files are added without re-uploading. Face detection runs
              afterwards on this device.
            </p>
            <Button onClick={run} className="w-full">
              Start import
            </Button>
          </div>
        )}

        {phase === "syncing" && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p>
              Syncing Drive folder… imported{" "}
              <span className="font-semibold">{synced.imported}</span>, skipped{" "}
              <span className="font-semibold">{synced.skipped}</span>
            </p>
          </div>
        )}

        {phase === "scanning" && (
          <div className="space-y-3 py-2">
            <Progress value={undefined} className="h-1.5 animate-pulse" />
            <p className="text-sm">
              Scanning photos for faces…{" "}
              <span className="font-semibold">{scanProgress.done}</span> done
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {scanProgress.current}
            </p>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-4 py-2 text-center">
            <p className="text-sm">
              Imported <span className="font-semibold">{synced.imported}</span>{" "}
              photos and scanned{" "}
              <span className="font-semibold">{scanProgress.done}</span> for
              faces.
            </p>
            <Button onClick={() => setOpen(false)} className="w-full">
              Done
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
