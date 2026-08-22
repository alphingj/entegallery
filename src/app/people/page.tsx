"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Merge, X } from "lucide-react";
import { fetchPeople, mergePeople, type PersonSummary } from "@/lib/api-client";
import { FaceCrop } from "@/components/face-crop";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRoundX } from "lucide-react";
import { Nav } from "@/components/nav";
import { toast } from "sonner";

function MergeDialog({
  people,
  sourceIds,
  onClose,
  onDone,
}: {
  people: PersonSummary[];
  sourceIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const named = people.filter((p) => p.name !== "Unknown" && !sourceIds.includes(p.id));
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [targetId, setTargetId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const mutation = useMutation({
    mutationFn: () => {
      if (mode === "existing") {
        if (!targetId) throw new Error("Pick a person");
        return mergePeople({ sourceIds, targetId });
      }
      if (!newName.trim()) throw new Error("Name required");
      return mergePeople({ sourceIds, targetName: newName.trim() });
    },
    onSuccess: (r) => {
      toast.success(`Merged ${r.mergedPersons} persons into ${r.keeperName} (${r.movedFaces} faces)`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Merge failed"),
  });
  const valid = mode === "existing" ? !!targetId : !!newName.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge {sourceIds.length} persons</DialogTitle>
          <DialogDescription>Add to existing person where already added names come, or create a new one. Superb similar duplicates collapse in one tap.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "existing" ? "secondary" : "ghost"} onClick={() => setMode("existing")} disabled={named.length === 0}>Add to existing person</Button>
          <Button size="sm" variant={mode === "new" ? "secondary" : "ghost"} onClick={() => setMode("new")}>New person</Button>
        </div>
        {mode === "existing" ? (
          named.length === 0 ? (
            <p className="text-sm text-muted-foreground">No named people yet — create a new one.</p>
          ) : (
            <div className="space-y-2">
              <Label>Existing person</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose person…" /></SelectTrigger>
                <SelectContent>
                  {named.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} · {p.photoCount} photos</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        ) : (
          <div className="space-y-2">
            <Label htmlFor="merge-new">New name</Label>
            <Input id="merge-new" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Priya" autoFocus />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Merging…" : "Merge"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PeoplePage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["people"],
    queryFn: () => fetchPeople(),
  });
  const people = data?.people ?? [];
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  return (
    <>
      <Nav active="people" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">People</h1>
          <div className="flex items-center gap-2">
            {!selectMode ? (
              <Button variant="outline" size="sm" className="min-h-9" onClick={() => setSelectMode(true)}>
                <CheckSquare className="mr-1.5 size-4" /> Select
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="min-h-9" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>
                <X className="mr-1.5 size-4" /> Exit select
              </Button>
            )}
          </div>
        </div>

        {selectMode && selected.size > 0 && (
          <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm sm:top-[calc(3.5rem+env(safe-area-inset-top))]">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Button
              size="sm"
              className="min-h-9"
              onClick={() => setMergeOpen(true)}
              disabled={selected.size < 2 && !Array.from(selected).some(() => true)}
            >
              <Merge className="mr-1.5 size-4" /> Merge {selected.size > 1 ? `(${selected.size})` : ""}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-square rounded-lg" />
                <Skeleton className="mx-auto h-4 w-20" />
              </div>
            ))}
          </div>
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-32 text-center">
            <UserRoundX className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No faces yet — upload photos and detected people will appear here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {people.map((person) => {
              const checked = selected.has(person.id);
              return (
                <div
                  key={person.id}
                  className="group relative space-y-2 touch-manipulation select-none"
                  onTouchStart={() => handleTouchStart(person.id)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(person.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${person.name}`}
                      className="absolute left-2 top-2 z-10 size-5 cursor-pointer rounded border bg-white/90 accent-primary shadow"
                    />
                  )}
                  <div onClick={() => (selectMode ? toggle(person.id) : undefined)} className={selectMode ? "cursor-pointer" : ""}>
                    <Link
                      href={selectMode ? "#" : `/people/${person.id}`}
                      onClick={(e) => { if (selectMode) { e.preventDefault(); toggle(person.id); } }}
                      className="block space-y-2"
                    >
                      {person.face ? (
                        <FaceCrop item={person.face} className={`rounded-lg ring-border transition-all ${checked ? "ring-2 ring-primary" : "group-hover:ring-2 group-hover:ring-primary"}`} />
                      ) : (
                        <div className={`grid aspect-square place-items-center rounded-lg bg-muted ${checked ? "ring-2 ring-primary" : ""}`}>
                          <UserRoundX className="size-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="text-center">
                        <p className={`truncate text-sm font-medium ${person.name === "Unknown" ? "italic text-muted-foreground" : ""}`}>{person.name}</p>
                        <Badge variant="secondary" className="mt-0.5 font-normal">{person.photoCount} photo{person.photoCount === 1 ? "" : "s"}</Badge>
                      </div>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {mergeOpen && (
          <MergeDialog
            people={people}
            sourceIds={Array.from(selected)}
            onClose={() => setMergeOpen(false)}
            onDone={() => {
              setSelected(new Set());
              setSelectMode(false);
              void queryClient.invalidateQueries({ queryKey: ["people"] });
            }}
          />
        )}
      </main>
    </>
  );
}
