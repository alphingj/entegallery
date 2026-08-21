"use client";

import { cn } from "@/lib/utils";
import type { FaceItem } from "@/lib/types";

/**
 * Renders a person's actual face (not the whole photo) by scaling the Drive
 * thumbnail so the stored bounding box fills a square card. Works because
 * boxes are squarified in pixel space at detection time.
 */
export function FaceCrop({
  item,
  className,
  children,
}: {
  item: FaceItem;
  className?: string;
  children?: React.ReactNode;
}) {
  const aspect = item.width && item.height ? item.width / item.height : 4 / 3;
  return (
    <div className={cn("relative aspect-square overflow-hidden bg-muted", className)}>
      {item.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute left-0 top-0 max-w-none select-none"
          style={{
            width: `${100 / item.box.width}%`,
            aspectRatio: String(aspect),
            transform: `translate(-${item.box.x * 100}%, -${item.box.y * 100}%)`,
          }}
        />
      )}
      {children}
    </div>
  );
}
