"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/nav";
import { FaceCrop } from "@/components/face-crop";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fetchSwipePending, type SwipePendingResponse, type SwipePerson, type SwipeTask } from "@/lib/api-client";

export default function SwipePage() {
  const router = useRouter();
  const [people, setPeople] = useState<SwipePerson[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"face_name" | "same_person">("face_name");
  const [skipSessionId] = useState(() => `skip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const [error, setError] = useState<string | null>(null);
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/verification/swipe-pending?skipSessionId=${encodeURIComponent(skipSessionId)}&limit=100`);
      const data = await res.json();
      setPeople(data.people || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load verification tasks");
    } finally {
      setLoading(false);
    }
  };

  const runGenerate = async () => {
    setLoading(true);
    try {
      await fetch("/api/verification/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceNameLimit: 20, samePersonLimit: 20 }),
      });
      await load();
    } catch (err) {
      console.error(err);
      setError("Failed to generate tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function decide(decision: "yes" | "no") {
    if (!currentTask) return;

    try {
      await fetch(`/api/verification/tasks/${currentTask.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });

      if (currentIndex + 1 >= flatTasks.length) {
        await load();
      } else {
        setCurrentIndex(i => i + 1);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to save decision");
    }
  }

  const handleSkip = async () => {
    if (!currentTask) return;

    try {
      await fetch(`/api/verification/tasks/${currentTask.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "skip" })
      });

      if (currentIndex + 1 >= flatTasks.length) {
        await load();
      } else {
        setCurrentIndex(i => i + 1);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to skip");
    }
  }

  const handleReassign = async () => {
    if (!selectedFaceId || !selectedPersonId) return;

    try {
      await fetch(`/api/verification/tasks/${selectedFaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "no", correctPersonId: selectedPersonId })
      });

      toast.success("Reassigned");
      setShowPersonPicker(false);
      setSelectedFaceId(null);
      setSelectedPersonId("");
      await load();
    } catch (err) {
      console.error(err);
      toast.error("Failed to reassign");
    }
  }

  const flatTasks = people.flatMap(p => p.tasks.map(t => ({ ...t, personId: p.personId, personName: p.personName })));
  const currentTask = flatTasks[currentIndex];
  const currentPerson = flatTasks[currentIndex]?.personName || "Unknown";
  const remaining = flatTasks.length - currentIndex;
  const progress = flatTasks.length > 0 ? ((currentIndex + 1) / flatTasks.length) * 100 : 0;

  return (
    <>
      <Nav active="verify" />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Swipe Validation</h1>
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

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : flatTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <p className="text-lg font-semibold">No pending tasks</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              All faces have been verified or there are no ambiguous faces to review.
            </p>
            <Button onClick={runGenerate} className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">
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
                  <img
                    src={currentTask.thumbnailUrl || "/placeholder.jpg"}
                    alt={currentTask.fileName || "Face"}
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                    <p className="font-medium truncate">{currentPerson}</p>
                    <p className="text-xs opacity-75">{currentTask.fileName}</p>
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
                  <Button size="lg" variant="outline" onClick={() => { setSelectedFaceId(currentTask.faceId); setShowPersonPicker(true); }} className="min-w-[120px]">
                    Reassign
                  </Button>
                </div>
              </div>
            )}

            {showPersonPicker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
                  <h3 className="mb-4 text-lg font-semibold">Reassign to person</h3>
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
                    <Button variant="outline" onClick={() => setShowPersonPicker(false)}>Cancel</Button>
                    <Button onClick={handleReassign} disabled={!selectedPersonId}>Confirm</Button>
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