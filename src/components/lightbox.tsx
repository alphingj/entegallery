"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchPhotoFaces } from "@/lib/api-client";

export interface LightboxPhoto {
  id: string;
  google_drive_file_id: string;
  file_name: string | null;
  width: number | null;
  height: number | null;
  /** HEIC can't be decoded by browsers — render Google's converted version */
  isHeic?: boolean;
}

export function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  highlightFaceId,
}: {
  photos: LightboxPhoto[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  highlightFaceId?: string | null;
}) {
  const photo = photos[index];
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const touchStartX = useRef<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["photo-faces", photo?.id],
    queryFn: () => fetchPhotoFaces(photo!.id),
    enabled: !!photo,
  });

  useEffect(() => {
    const onResize = () => {
      const vv = window.visualViewport;
      setViewport({
        w: vv ? vv.width : window.innerWidth,
        h: vv ? vv.height : window.innerHeight,
      });
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < photos.length - 1)
        onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onClose, onIndexChange]);

  const stage = useMemo(() => {
    if (!photo || !viewport) return null;
    const w = photo.width ?? 4;
    const h = photo.height ?? 3;
    const maxW = viewport.w * 0.92;
    const maxH = viewport.h * 0.78;
    return {
      aspect: w / h,
      width: Math.min(maxW, maxH * (w / h)),
    };
  }, [photo, viewport]);

  if (!photo) return null;

  const people = Object.values(
    Object.fromEntries(
      (data?.faces ?? []).map((f) => [f.personId, f])
    )
  );

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-black/95 backdrop-blur-sm">
      {/* top bar */}
      <div className="flex items-center justify-between gap-2 px-3 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white sm:px-4">
        <span className="min-w-0 flex-1 truncate text-sm text-white/70">
          {photo.file_name} · {index + 1}/{photos.length}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 text-white hover:bg-white/10 hover:text-white max-[360px]:px-2"
            onClick={async () => {
              const url = photo.isHeic
                ? `https://drive.google.com/thumbnail?id=${photo.google_drive_file_id}&sz=w2048`
                : `/api/image/${photo.google_drive_file_id}`;
              const res = await fetch(url);
              const blob = await res.blob();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = photo.file_name || `photo-${photo.id}.jpg`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}
          >
            <Download className="size-4" /> <span className="hidden sm:inline">Download</span>
          </Button>
          <Button variant="ghost" size="icon" className="size-11" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </Button>
        </div>
      </div>

      {/* stage */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2 sm:px-6 lg:px-10"
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(dx) < 40) return;
          if (dx < 0 && index < photos.length - 1) onIndexChange(index + 1);
          else if (dx > 0 && index > 0) onIndexChange(index - 1);
        }}
      >
        {stage && (
          <div
            className="relative"
            style={{ aspectRatio: String(stage.aspect), width: stage.width }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                photo.isHeic
                  ? `https://drive.google.com/thumbnail?id=${photo.google_drive_file_id}&sz=w1600`
                  : `/api/image/${photo.google_drive_file_id}`
              }
              alt={photo.file_name ?? ""}
              className="h-full w-full object-contain"
              draggable={false}
            />
            {(data?.faces ?? []).map((f) => (
              <div
                key={f.faceId}
                className={`absolute rounded-sm border-2 ${
                  highlightFaceId && f.faceId !== highlightFaceId
                    ? "border-white/25"
                    : "border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0)]"
                }`}
                style={{
                  left: `${f.box.x * 100}%`,
                  top: `${f.box.y * 100}%`,
                  width: `${f.box.width * 100}%`,
                  height: `${f.box.height * 100}%`,
                }}
                title={f.name}
              />
            ))}
          </div>
        )}

        {isLoading && (
          <Loader2 className="absolute size-8 animate-spin text-white/50" />
        )}

        {index > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-2 top-1/2 hidden size-11 -translate-y-1/2 text-white hover:bg-white/10 sm:flex"
            onClick={() => onIndexChange(index - 1)}
            aria-label="Previous"
          >
            <ChevronLeft className="size-7" />
          </Button>
        )}
        {index < photos.length - 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 hidden size-11 -translate-y-1/2 text-white hover:bg-white/10 sm:flex"
            onClick={() => onIndexChange(index + 1)}
            aria-label="Next"
          >
            <ChevronRight className="size-7" />
          </Button>
        )}
      </div>

      {/* people chips */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3 pb-[env(safe-area-inset-bottom)]">
        {people.length === 0 && !isLoading && (
          <Skeleton className="h-6 w-40" />
        )}
        {people.map((p) => (
          <Link key={p.personId} href={`/people/${p.personId}`}>
            <Badge variant="secondary" className="min-h-7 cursor-pointer py-1 hover:bg-secondary/80">
              {p.name}
            </Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}
