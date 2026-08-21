"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudUpload, Loader2, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useUpload, type UploadItem } from "@/hooks/use-upload";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function StatusLine({ item }: { item: UploadItem }) {
  switch (item.status) {
    case "queued":
      return <span className="text-xs text-muted-foreground">Queued…</span>;
    case "detecting":
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Detecting faces…
        </span>
      );
    case "uploading":
      return (
        <Progress value={item.progress} className="mt-1 h-1.5" />
      );
    case "done":
      return (
        <span className="text-xs text-emerald-500">
          Uploaded{item.tagged?.length
            ? ` · tagged ${[...new Set(item.tagged.map((t) => t.name))].join(", ")}`
            : " · no faces found"}
        </span>
      );
    case "error":
      return <span className="text-xs text-destructive">{item.error}</span>;
  }
}

export function UploadSheet() {
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const queryClient = useQueryClient();

  const onAllDone = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["photos"] });
    void queryClient.invalidateQueries({ queryKey: ["people"] });
    toast.success("Upload complete");
  }, [queryClient]);

  const { items, addFiles, reset } = useUpload(onAllDone);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button>
          <CloudUpload className="size-4" /> Upload
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-4 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Upload photos</SheetTitle>
          <SheetDescription>
            Faces are detected in your browser; files go straight to Google Drive.
          </SheetDescription>
        </SheetHeader>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
          )}
        >
          <CloudUpload className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drag & drop photos here, or click to browse
          </p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>

        {items.length > 0 && (
          <div className="-mr-2 flex flex-1 flex-col gap-3 overflow-y-auto pr-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.file.name}</p>
                    <StatusLine item={item} />
                  </div>
                  {item.status === "error" && (
                    <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label="Remove">
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
