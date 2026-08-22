"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchPhotos } from "@/lib/api-client";
import { Lightbox } from "@/components/lightbox";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared infinite-scroll photo grid used by both the Photos and HEIC tabs.
 * HEIC items render via Google's server-converted thumbnails; their full-res
 * view also uses the CDN since browsers can't decode HEIC natively.
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

  return (
    <>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 18 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-32 text-center">
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
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              onClick={() => setLightboxIndex(i)}
              className="group relative overflow-hidden rounded-md bg-muted focus-visible:outline-2 focus-visible:outline-primary"
              style={{ aspectRatio: "1 / 1" }}
              aria-label={`Open ${photo.file_name ?? "photo"}`}
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
            </button>
          ))}
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
            isHeic:
              p.mime_type === "image/heic" ||
              p.mime_type === "image/heif" ||
              /\.(heic|heif)$/i.test(p.file_name ?? ""),
          }))}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}