"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Nav } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { SwipePerson } from "@/lib/api-client";

export default function SwipePage() {
  const [people, setPeople] = useState<SwipePerson[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"face_name" | "same_person">("face_name");
  const [skipSessionId] = useState(() => `skip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
  const [error, setError] = useState<string | null>(null);
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/verification/swipe-pending?skipSessionId=${encodeURIComponent(skipSessionId)}&limit=100`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to load");
      setPeople(data.people || []);
      setCurrentIndex(0);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load verification tasks");
    } finally {
      setLoading(false);
    }
  };

  const runGenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verification/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceNameLimit: 20, samePersonLimit: 20 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "generate failed");
      toast.success(`Generated ${j.createdFaceName ?? 0} face_name + ${j.createdSamePerson ?? 0} same_person tasks`);
      await load();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate tasks");
      toast.error(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flatTasks = people.flatMap((p) => p.tasks.map((t) => ({ ...t, personId: p.personId, personName: p.personName })));
  const currentTask = flatTasks[currentIndex];
  const currentPerson = currentTask?.personName || "Unknown";
  const remaining = flatTasks.length - currentIndex;
  const progress = flatTasks.length > 0 ? ((currentIndex + 1) / flatTasks.length) * 100 : 0;

  async function decide(decision: "yes" | "no") {
    if (!currentTask) return;
    try {
      const res = await fetch(`/api/verification/tasks/${currentTask.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "save failed");
      toast.success(decision === "yes" ? "Confirmed" : "Rejected");
      if (currentIndex + 1 >= flatTasks.length) {
        await load();
      } else {
        setCurrentIndex((i) => i + 1);
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to save decision");
    }
  }

  const handleSkip = async () => {
    if (!currentTask) return;
    try {
      const res = await fetch(`/api/verification/tasks/${currentTask.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "skip", skipSessionId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "skip failed");
      toast("Skipped — won't show again this session");
      if (currentIndex + 1 >= flatTasks.length) {
        await load();
      } else {
        setCurrentIndex((i) => i + 1);
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to skip");
    }
  };

  const handleReassign = async () => {
    if (!selectedTaskId || !selectedPersonId) return;
    try {
      const res = await fetch(`/api/verification/tasks/${selectedTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "no", correctPersonId: selectedPersonId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "reassign failed");
      toast.success("Reassigned");
      setShowPersonPicker(false);
      setSelectedTaskId(null);
      setSelectedPersonId("");
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to reassign");
    }
  };

  return (
    <>
      <Nav active="verify" />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="min-h-9">
              <Link href="/verify">
                <ArrowLeft className="mr-1.5 size-4" /> Back
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">Swipe Validation</h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMode("face_name")}
              className={mode === "face_name" ? "bg-secondary" : ""}
            >
              Face = Name
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMode("same_person")}
              className={mode === "same_person" ? "bg-secondary" : ""}
            >
              Same person?
            </Button>
            <Button variant="outline" size="sm" onClick={runGenerate} disabled={loading}>
              Generate
            </Button>
          </div>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          {mode === "face_name"
            ? "Swipe through faces to confirm or correct identifications. Skip defers to next session."
            : "Compare two faces to see if they're the same person."}
        </p>

        {error && <p className="mb-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : flatTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <p className="text-lg font-semibold">No pending tasks</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              All faces have been verified or there are no ambiguous faces to review. Tap Generate to create tasks from Unknowns that match a known person.
            </p>
            <Button onClick={runGenerate} className="mt-4">
              Generate tasks
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {currentIndex + 1} of {flatTasks.length} faces
              </span>
              <span className="text-muted-foreground">
                {remaining} remaining · Person: {currentPerson}
              </span>
            </div>
            <Progress value={progress} className="h-2" />

            {currentTask && (
              <div className="space-y-4">
                <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentTask.thumbnailUrl || "/placeholder.jpg"}
                    alt={currentTask.fileName || "Face"}
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                    <p className="font-medium truncate">{currentPerson}</p>
                    <p className="text-xs opacity-75 truncate">{currentTask.fileName ?? currentTask.photoId.slice(0, 8)}</p>
                    {currentTask.bestDistance != null && (
                      <p className="text-[11px] opacity-60">dist {currentTask.bestDistance.toFixed(3)}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap justify-center gap-3">
                  <Button size="lg" onClick={() => decide("yes")} className="min-w-[120px] bg-green-600 hover:bg-green-700">
                    Yes
                  </Button>
                  <Button size="lg" variant="destructive" onClick={() => decide("no")} className="min-w-[120px]">
                    No
                  </Button>
                  <Button size="lg" variant="outline" onClick={handleSkip} className="min-w-[120px]">
                    Skip
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => {
                      setSelectedTaskId(currentTask.taskId);
                      setShowPersonPicker(true);
                    }}
                    className="min-w-[120px]"
                  >
                    Reassign
                  </Button>
                </div>
              </div>
            )}

            {showPersonPicker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowPersonPicker(false)}>
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
                  <h3 className="mb-4 text-lg font-semibold">Reassign to person</h3>
                  <p className="mb-3 text-xs text-muted-foreground">Marks the suggestion as wrong and moves the face to the chosen person.</p>
                  <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
                    <SelectTrigger className="mb-4">
                      <SelectValue placeholder="Select person" />
                    </SelectTrigger>
                    <SelectContent>
                      {people.map((p) => (
                        <SelectItem key={p.personId} value={p.personId}>
                          {p.personName} ({p.faceCount})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowPersonPicker(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleReassign} disabled={!selectedPersonId}>
                      Confirm
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
