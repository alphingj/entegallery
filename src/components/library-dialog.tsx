"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CloudDownload,
  Copy,
  Loader2,
  ScanFace,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import {
  deletePhoto,
  fetchImportStatus,
  findDuplicatesPage,
  type DuplicateGroup,
} from "@/lib/api-client";
import { runFaceScan, runImportSync } from "@/lib/import-runner";

type Phase =
  | "idle"
  | "syncing"
  | "scanning"
  | "duplicates"
  | "done";

type Action = "import" | "identify" | "both" | null;

/**
 * Library maintenance dialog:
 *  - Continue importing        (Drive → DB metadata, idempotent)
 *  - Continue identification   (browser face scan of pending photos)
 *  - Continue importing & identification
 *  - Check for duplicates      (md5-based exact duplicate finder)
 */
export function LibraryDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [runningAction, setRunningAction] = useState<Action>(null);
  const [includeHeic, setIncludeHeic] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("includeHeic") !== "false"
  );
  const [synced, setSynced] = useState({ imported: 0, skipped: 0 });
  const [scanProgress, setScanProgress] = useState({ done: 0, current: "" });
  const [unscanned, setUnscanned] = useState<number | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [dupesProgress, setDupesProgress] = useState({ scanned: 0 });
  const [error, setError] = useState<string | null>(null);

  // Refresh unscanned count when dialog opens
  useEffect(() => {
    if (!open) return;
    void fetchImportStatus()
      .then((s) => setUnscanned(s.unscannedCount))
      .catch(() => {});
  }, [open]);

  const refreshQueries = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["photos"] });
    await queryClient.invalidateQueries({ queryKey: ["people"] });
  }, [queryClient]);

  async function runSync() {
    await runImportSync(includeHeic, (imported, skipped) =>
      setSynced({ imported, skipped })
    );
  }

  async function runScan(): Promise<number> {
    const done = await runFaceScan((d, current) =>
      setScanProgress({ done: d, current })
    );
    return done;
  }

  async function handleAction(action: Exclude<Action, null>) {
    setError(null);
    setDuplicateGroups([]);
    try {
      if (action === "import" || action === "both") {
        setPhase("syncing");
        setRunningAction(action);
        await runSync();
      }
      if (action === "identify" || action === "both") {
        setPhase("scanning");
        setRunningAction(action);
        setScanProgress({ done: 0, current: "" });
        const done = await runScan();
        toast.success(`Scanned ${done} photos for faces`);
      }
      setPhase("done");
      await refreshQueries();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setRunningAction(null);
      void fetchImportStatus().then((s) => setUnscanned(s.unscannedCount)).catch(() => {});
    }
  }

  async function handleFindDuplicates() {
    setError(null);
    setDuplicateGroups([]);
    setPhase("duplicates");
    setRunningAction("both");
    try {
      let token: string | undefined = undefined;
      let scanned = 0;
      const allGroups: DuplicateGroup[] = [];
      do {
        const page = await findDuplicatesPage(token);
        scanned += page.updated;
        setDupesProgress({ scanned });
        // merge groups by md5
        for (const g of page.groups) {
          const existingGroup = allGroups.find((e) => e.md5 === g.md5);
          if (existingGroup) {
            const seenIds = new Set(existingGroup.items.map((i) => i.id));
            for (const item of g.items) {
              if (!seenIds.has(item.id)) {
                existingGroup.items.push(item);
                seenIds.add(item.id);
              }
            }
          } else {
            allGroups.push(g);
          }
        }
        setDuplicateGroups(allGroups.filter((g) => g.items.length > 1));
        token = page.nextPageToken ?? undefined;
      } while (token);

      const total = allGroups.filter((g) => g.items.length > 1).length;
      if (total === 0) {
        toast.success("No duplicates found");
      } else {
        toast.success(`Found ${total} duplicate group${total === 1 ? "" : "s"}`);
      }
      setPhase("done");
      await refreshQueries();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Duplicate check failed");
    } finally {
      setRunningAction(null);
    }
  }

  async function handleTrash(photoId: string) {
    try {
      await deletePhoto(photoId);
      setDuplicateGroups((groups) =>
        groups
          .map((g) => ({ ...g, items: g.items.filter((i) => i.id !== photoId) }))
          .filter((g) => g.items.length > 1)
      );
      await refreshQueries();
      toast.success("Moved to Drive trash");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const busy = runningAction !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles className="size-4" /> Library
          {unscanned !== null && unscanned > 0 && (
            <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {unscanned}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Library maintenance</DialogTitle>
          <DialogDescription>
            Sync your Drive folder, scan faces, and find duplicates.
          </DialogDescription>
        </DialogHeader>

        {/* Skip HEIC toggle */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="skip-heic" className="text-sm font-medium">
              Skip HEIC images during import
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              HEIC can&apos;t be decoded in-browser; they land in the HEIC tab when included.
            </p>
          </div>
          <input
            id="skip-heic"
            type="checkbox"
            checked={!includeHeic}
            disabled={busy}
            onChange={(e) => {
              const v = !e.target.checked;
              setIncludeHeic(v);
              localStorage.setItem("includeHeic", String(v));
            }}
            className="size-4 cursor-pointer accent-primary"
          />
        </div>

        {phase === "idle" || phase === "done" ? (
          <div className="space-y-2">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Actions
            </p>

            <Button
              onClick={() => handleAction("import")}
              disabled={busy}
              variant="outline"
              className="w-full justify-start"
            >
              <CloudDownload className="mr-2 size-4" />
              Continue importing
            </Button>

            <Button
              onClick={() => handleAction("identify")}
              disabled={busy}
              variant="outline"
              className="w-full justify-start"
            >
              <ScanFace className="mr-2 size-4" />
              Continue identification
              {unscanned !== null && unscanned > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {unscanned} pending
                </span>
              )}
            </Button>

            <Button
              onClick={() => handleAction("both")}
              disabled={busy}
              variant="outline"
              className="w-full justify-start"
            >
              <Sparkles className="mr-2 size-4" />
              Continue importing &amp; identification
            </Button>

            <Button
              onClick={handleFindDuplicates}
              disabled={busy}
              variant="outline"
              className="w-full justify-start"
            >
              <Copy className="mr-2 size-4" />
              Check for duplicates
            </Button>
          </div>
        ) : null}

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
            {scanProgress.current && (
              <p className="truncate text-xs text-muted-foreground">
                {scanProgress.current}
              </p>
            )}
          </div>
        )}

        {phase === "duplicates" && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p>
              Scanning Drive for duplicates…{" "}
              <span className="font-semibold">{dupesProgress.scanned}</span> files
              checked
            </p>
          </div>
        )}

        {duplicateGroups.length > 0 && (
          <div className="-mx-2 space-y-4 overflow-y-auto px-2" style={{ maxHeight: 320 }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {duplicateGroups.length} duplicate group
                {duplicateGroups.length === 1 ? "" : "s"} — pick copies to trash
              </p>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  if (
                    !confirm(
                      `Trash all duplicates? Keeps 1 copy per group, moves ${duplicateGroups.reduce(
                        (a, g) => a + g.items.length - 1,
                        0
                      )} files to Drive trash (recoverable 30 days).`
                    )
                  )
                    return;
                  setError(null);
                  try {
                    for (const g of duplicateGroups) {
                      for (const item of g.items.slice(1)) {
                        await deletePhoto(item.id);
                      }
                    }
                    const kept = duplicateGroups.length;
                    toast.success(`Trashed duplicates, kept ${kept} original${kept === 1 ? "" : "s"}`);
                    setDuplicateGroups([]);
                    await refreshQueries();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Bulk delete failed");
                  }
                }}
              >
                <Trash2 className="mr-1.5 size-4" /> Delete all duplicates
              </Button>
            </div>
            {duplicateGroups.map((group) => (
              <div key={group.md5} className="rounded-lg border p-3">
                <p className="mb-2 truncate text-xs text-muted-foreground">
                  md5 {group.md5.slice(0, 12)}… · {group.items.length} identical files
                </p>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      {item.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnail_url}
                          alt=""
                          className="size-10 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="size-10 shrink-0 rounded bg-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{item.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.byte_size
                            ? `${(item.byte_size / 1024 / 1024).toFixed(2)} MB`
                            : ""}{" "}
                          · {new Date(item.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => handleTrash(item.id)}
                        aria-label={`Trash ${item.file_name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {phase === "done" && duplicateGroups.length === 0 && runningAction === null && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            All caught up. Pick another action above.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}