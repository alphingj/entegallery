"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Download, X } from "lucide-react";
import { fetchPhotos } from "@/lib/api-client";
import { Lightbox } from "@/components/lightbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function isHeicItem(p: { mime_type: string | null; file_name: string | null }) {
  return (
    p.mime_type === "image/heic" ||
    p.mime_type === "image/heif" ||
    /\.(heic|heif)$/i.test(p.file_name ?? "")
  );
}

/**
 * Shared infinite-scroll photo grid used by both the Photos and HEIC tabs.
 * - HEIC thumbnails via Google CDN; full-res via CDN for heic.
 * - Long-press (450ms) enters select mode; then checkboxes + bulk bar appear.
 */
export function LibraryGrid({ heic }: { heic: "exclude" | "only" }) {
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["photos", heic],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPhotos(pageParam, heic),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [zipping, setZipping] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const photos = data?.pages.flatMap((p) => p.photos) ?? [];

  // Clear selection when switching tabs (heic prop change)
  const prevHeicRef = useRef(heic);
  useEffect(() => {
    if (prevHeicRef.current === heic) return;
    prevHeicRef.current = heic;
    setSelected(new Set());
    setSelectMode(false);
  }, [heic]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleTouchStart(id: string) {
    if (selectMode) return;
    longPressTimer.current = setTimeout(() => {
      setSelectMode(true);
      toggle(id);
      navigator.vibrate?.(20);
    }, 450);
  }
  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function downloadZip() {
    if (selected.size === 0) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const chosen = photos.filter((p) => selected.has(p.id));
      for (const p of chosen) {
        const url = isHeicItem(p)
          ? `https://drive.google.com/thumbnail?id=${p.google_drive_file_id}&sz=w2048`
          : `/api/image/${p.google_drive_file_id}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${p.file_name}`);
        const blob = await res.blob();
        let name = p.file_name || `${p.id}.jpg`;
        if (isHeicItem(p) && /\.(heic|heif)$/i.test(name)) {
          name = name.replace(/\.(heic|heif)$/i, ".jpg");
        }
        zip.file(name, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const stamp = new Date().toISOString().slice(0, 10);
      saveAs(out, `ente-gallery-${heic === "only" ? "heic-" : ""}${stamp}.zip`);
      toast.success(`Downloaded ${chosen.length} photo${chosen.length === 1 ? "" : "s"} as ZIP`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ZIP download failed");
    } finally {
      setZipping(false);
    }
  }

  return (
    <>
      {/* Bulk bar — only in select mode */}
      {selectMode && selected.size > 0 && (
        <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm sm:top-[calc(3.5rem+env(safe-area-inset-top))]">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" className="min-h-11" onClick={downloadZip} disabled={zipping}>
              <Download className="mr-1.5 size-4" />
              {zipping ? "Zipping…" : `Download ZIP`}
            </Button>
            <Button size="sm" variant="ghost" className="min-h-11" onClick={exitSelectMode}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}
      {selectMode && selected.size === 0 && (
        <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 mb-3 flex items-center justify-between rounded-lg border bg-card px-3 py-2 shadow-sm sm:top-[calc(3.5rem+env(safe-area-inset-top))]">
          <span className="text-sm text-muted-foreground">Long-press photos to select · tap to toggle</span>
          <Button size="sm" variant="ghost" className="min-h-11" onClick={exitSelectMode}>Exit</Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 18 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-2 py-16 text-center sm:py-24">
          <h1 className="text-lg font-semibold">
            {heic === "only" ? "No HEIC images" : "No photos yet"}
          </h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            {heic === "only"
              ? "Turn off “Skip HEIC images” in the Library dialog and re-run import to index them."
              : "Hit Upload to add your first photo — faces are detected right in your browser and files land in your Google Drive folder."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {photos.map((photo, i) => {
            const checked = selected.has(photo.id);
            return (
              <div
                key={photo.id}
                className="group relative overflow-hidden rounded-md bg-muted focus-within:outline-2 focus-within:outline-primary touch-manipulation select-none"
                style={{ aspectRatio: "1 / 1" }}
                onTouchStart={() => handleTouchStart(photo.id)}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
                onContextMenu={(e) => e.preventDefault()}
              >
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(photo.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${photo.file_name ?? "photo"}`}
                    className="absolute left-2 top-2 z-10 size-4 cursor-pointer rounded border bg-white/90 accent-primary shadow sm:size-5"
                  />
                )}
                {/* enlarged tap target for checkbox on touch */}
                {selectMode && (
                  <button
                    aria-hidden
                    onClick={(e) => { e.stopPropagation(); toggle(photo.id); }}
                    className="absolute left-0 top-0 z-[9] size-11"
                  />
                )}
                <button
                  onClick={() => {
                    if (selectMode) toggle(photo.id);
                    else setLightboxIndex(i);
                  }}
                  className="absolute inset-0 focus-visible:outline-none"
                  aria-label={`${selectMode ? (checked ? "Deselect" : "Select") : "Open"} ${photo.file_name ?? "photo"}`}
                >
                  {photo.thumbnail_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo.thumbnail_url}
                      alt={photo.file_name ?? ""}
                      loading="lazy"
                      draggable={false}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  )}
                  {checked && selectMode && (
                    <span className="absolute inset-0 ring-2 ring-primary ring-inset" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div ref={sentinelRef} />
      {isFetchingNextPage && (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos.map((p) => ({
            ...p,
            isHeic: isHeicItem(p),
          }))}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
