"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CornerUpRight,
  MoreVertical,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { fetchPeople, fetchPersonFaces, mergePeople, moveFace, renamePerson, type FaceItem } from "@/lib/api-client";
import { FaceCrop } from "@/components/face-crop";
import { Lightbox, type LightboxPhoto } from "@/components/lightbox";
import { Nav } from "@/components/nav";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function MoveFaceDialog({
  face,
  currentPersonId,
  onClose,
}: {
  face: FaceItem;
  currentPersonId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [newName, setNewName] = useState("");
  const [targetPerson, setTargetPerson] = useState<string>("");

  const { data: peopleData } = useQuery({
    queryKey: ["people"],
    queryFn: () => fetchPeople(),
  });
  const others = (peopleData?.people ?? []).filter((p) => p.id !== currentPersonId);

  const mutation = useMutation({
    mutationFn: () =>
      moveFace(face.faceId, mode === "new" ? { newName } : { personId: targetPerson }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["person-faces"] });
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      await queryClient.invalidateQueries({ queryKey: ["photos"] });
      toast.success("Face moved");
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Move failed"),
  });

  const valid = mode === "new" ? newName.trim().length > 0 : targetPerson !== "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move this face</DialogTitle>
          <DialogDescription>
            Attach this detected face to a different person.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 text-sm">
          <Button
            type="button"
            size="sm"
            variant={mode === "new" ? "secondary" : "ghost"}
            onClick={() => setMode("new")}
          >
            New person
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "existing" ? "secondary" : "ghost"}
            disabled={others.length === 0}
            onClick={() => setMode("existing")}
          >
            Existing
          </Button>
        </div>

        {mode === "new" ? (
          <div className="space-y-2">
            <Label htmlFor="new-name">Name</Label>
            <Input
              id="new-name"
              value={newName}
              autoFocus
              placeholder="e.g. Priya"
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Person</Label>
            <Select value={targetPerson} onValueChange={setTargetPerson}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a person…" />
              </SelectTrigger>
              <SelectContent>
                {others.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Moving…" : "Move face"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PersonView({ personId }: { personId: string }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renameMode, setRenameMode] = useState<"new" | "existing">("new");
  const [renameTargetId, setRenameTargetId] = useState("");
  const [moveTarget, setMoveTarget] = useState<FaceItem | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [highlightedFaces, setHighlightedFaces] = useState<Set<string>>(new Set());

  const { data: peopleData } = useQuery({
    queryKey: ["people"],
    queryFn: () => fetchPeople(),
  });
  const person = peopleData?.people.find((p) => p.id === personId);

  const { data: facesData, isLoading } = useQuery({
    queryKey: ["person-faces", personId],
    queryFn: () => fetchPersonFaces(personId),
  });

  const renameMutation = useMutation({
    mutationFn: () => {
      if (renameMode === "existing") {
        if (!renameTargetId) throw new Error("Pick a person");
        return mergePeople({ sourceIds: [personId], targetId: renameTargetId });
      }
      return renamePerson(personId, nameDraft);
    },
    onSuccess: async (res: { keeperName?: string; person?: { name: string } }) => {
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      await queryClient.invalidateQueries({ queryKey: ["person-faces"] });
      setRenaming(false);
      if (renameMode === "existing") {
        toast.success(`Merged into ${(res as { keeperName?: string })?.keeperName ?? "person"}`);
      } else {
        toast.success(`Renamed to “${nameDraft.trim()}”`);
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Rename failed"),
  });

  // When opening the lightbox for one crop, highlight every face of THIS person
  // in that photo (they may appear multiple times).
  const openLightbox = (item: FaceItem) => {
    const siblings =
      facesData?.items.filter(
        (f) => f.photoId === item.photoId && f.faceId !== item.faceId
      ) ?? [];
    void siblings;
    setLightboxIndex(facesData!.items.findIndex((f) => f.faceId === item.faceId));
    collectHighlights(item.photoId);
  };

  const collectHighlights = (photoId: string) => {
    const ids = new Set(
      (facesData?.items ?? [])
        .filter((f) => f.photoId === photoId)
        .map((f) => f.faceId)
    );
    setHighlightedFaces(ids);
  };

  const items = facesData?.items ?? [];

  const lightboxPhotos: LightboxPhoto[] = useMemoPhotos(items);

  return (
    <>
      <Nav active="people" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="mb-6 flex items-center gap-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back to People">
            <Link href="/people">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          {person?.face && (
            <FaceCrop item={person.face} className="size-14 shrink-0 rounded-full" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1
                className={`truncate text-xl font-semibold ${
                  person?.name === "Unknown" ? "italic text-muted-foreground" : ""
                }`}
              >
                {person?.name ?? "…"}
              </h1>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Rename"
                onClick={() => {
                  setNameDraft(person?.name ?? "");
                  setRenaming(true);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {items.length} appearance{items.length === 1 ? "" : "s"} across your library
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-24 text-center text-sm text-muted-foreground">
            No appearances found.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {items.map((item) => (
              <div key={item.faceId} className="group relative">
                <button
                  className="block w-full focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => openLightbox(item)}
                  aria-label="Open photo"
                >
                  <FaceCrop
                    item={item}
                    className="rounded-lg transition-all group-hover:brightness-110"
                  />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute right-1.5 top-1.5 size-7 opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="Face options"
                    >
                      <MoreVertical className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setMoveTarget(item)}>
                      <CornerUpRight className="size-4" /> Move to another person…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="mt-1 truncate px-0.5 text-xs text-muted-foreground">
                  {item.fileName}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* rename/merge dialog */}
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{renameMode === "existing" ? "Merge into existing person" : "Rename person"}</DialogTitle>
            <DialogDescription>
              {renameMode === "existing"
                ? "Merge this person's faces into an existing person."
                : "Renaming updates this face everywhere it appears — past and future uploads."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={renameMode === "new" ? "secondary" : "ghost"}
              onClick={() => setRenameMode("new")}
            >
              New name
            </Button>
            <Button
              type="button"
              size="sm"
              variant={renameMode === "existing" ? "secondary" : "ghost"}
              disabled={!peopleData || peopleData.people.filter((p) => p.id !== personId).length === 0}
              onClick={() => setRenameMode("existing")}
            >
              Add to existing person
            </Button>
          </div>
          {renameMode === "new" ? (
            <div className="space-y-2">
              <Input
                value={nameDraft}
                autoFocus
                placeholder="Name"
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nameDraft.trim())
                    renameMutation.mutate();
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Existing person</Label>
              <Select value={renameTargetId} onValueChange={setRenameTargetId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose person…" />
                </SelectTrigger>
                <SelectContent>
                  {peopleData?.people
                    .filter((p) => p.id !== personId)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {p.photoCount} photos
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                renameMode === "new" ? !nameDraft.trim() : !renameTargetId || renameMutation.isPending
              }
              onClick={() => renameMutation.mutate()}
            >
              <Check className="size-4" /> {renameMode === "new" ? "Save" : "Merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {moveTarget && (
        <MoveFaceDialog
          face={moveTarget}
          currentPersonId={personId}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={lightboxPhotos}
          index={lightboxIndex}
          highlightFaceId={
            [...highlightedFaces][0] ?? null
          }
          onIndexChange={(i) => {
            setLightboxIndex(i);
            if (lightboxPhotos[i]) {
              const faceForPhoto = items.find(
                (f) => f.photoId === lightboxPhotos[i].id
              );
              if (faceForPhoto) collectHighlights(faceForPhoto.photoId);
            }
          }}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

// tiny helper to keep the component body readable
function useMemoPhotos(items: FaceItem[]): LightboxPhoto[] {
  return items.map((item) => ({
    id: item.photoId,
    google_drive_file_id: item.fileId,
    file_name: item.fileName,
    width: item.width,
    height: item.height,
  }));
}
