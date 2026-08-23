"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Nav } from "@/components/nav";
import { FaceCrop } from "@/components/face-crop";
import type { FaceItem } from "@/lib/types";

type VerifTask = {
  id: string;
  kind: "same_person" | "face_name";
  status: string;
  best_distance?: number | null;
  face_a?: { id: string; bounding_box: FaceItem["box"]; photo_id: string; photos: { thumbnail_url: string | null; file_name: string | null; google_drive_file_id: string; width: number | null; height: number | null } } | null;
  face_b?: { id: string; bounding_box: FaceItem["box"]; photo_id: string; photos: { thumbnail_url: string | null; file_name: string | null; google_drive_file_id: string; width: number | null; height: number | null } } | null;
  person?: { id: string; name: string } | null;
};

function toFaceItem(face: NonNullable<VerifTask["face_a"]>): FaceItem {
  return {
    faceId: face.id,
    photoId: face.photo_id,
    fileId: face.photos.google_drive_file_id,
    fileName: face.photos.file_name,
    thumbnailUrl: face.photos.thumbnail_url,
    box: face.bounding_box,
    width: face.photos.width,
    height: face.photos.height,
    createdAt: "",
  };
}

export default function VerifyPage() {
  const [tasks, setTasks] = useState<VerifTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"same_person" | "face_name">("face_name");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/verification/tasks?status=pending&kind=${kind}&limit=20`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed to load");
      setTasks(j.tasks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [kind]);

  const decide = async (id: string, decision: "yes" | "no") => {
    try {
      const r = await fetch(`/api/verification/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "save failed");
      toast.success(decision === "yes" ? "Confirmed" : "Rejected");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/verification/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceNameLimit: 20, samePersonLimit: 20 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "generate failed");
      const fn = j.createdFaceName ?? 0;
      const sp = j.createdSamePerson ?? 0;
      if (fn === 0 && sp === 0) {
        toast("No new tasks — need Unknown faces + at least one named person, or run Library → Continue identification first");
      } else {
        toast.success(`Generated ${fn} face_name + ${sp} same_person tasks`);
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Generate failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <Nav active="verify" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Verify faces</h1>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setKind("face_name")}
              className={kind === "face_name" ? "bg-secondary" : ""}
            >
              Face = Name?
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setKind("same_person")}
              className={kind === "same_person" ? "bg-secondary" : ""}
            >
              Same person?
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/verify/bulk">Bulk Name Entry</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/verify/swipe">Swipe Validation</Link>
            </Button>
            <Button variant="outline" onClick={generate} size="sm" disabled={generating || loading}>
              {generating ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              {generating ? "Generating…" : "Generate tasks"}
            </Button>
          </div>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {kind === "face_name"
            ? "Is this face really this person? Uses w600k_mbf 512d (0.30 threshold)."
            : "Are these two photos the same person?"}
        </p>
        {error && <p className="mb-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm">Loading...</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending tasks. Click Generate to create from ambiguous Unknowns.</p>
        ) : (
          <div className="space-y-4">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-xl border p-4">
                {t.kind === "face_name" && t.face_a ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                    <div className="flex-1">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Face to verify</p>
                      <FaceCrop item={toFaceItem(t.face_a)} className="mx-auto max-w-[220px] rounded-lg" />
                      <p className="mt-1 truncate text-center text-xs text-muted-foreground">{t.face_a.photos.file_name}</p>
                    </div>
                    <div className="flex flex-1 flex-col items-center">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested person</p>
                      {t.person ? (
                        <span className="rounded-full bg-secondary px-3 py-1.5 text-sm font-medium">{t.person.name}</span>
                      ) : (
                        <span className="text-sm italic text-muted-foreground">Unknown</span>
                      )}
                      <div className="mt-4 flex gap-2">
                        <Button size="sm" onClick={() => decide(t.id, "yes")}>Yes same</Button>
                        <Button size="sm" variant="outline" onClick={() => decide(t.id, "no")}>No</Button>
                      </div>
                    </div>
                  </div>
                ) : t.kind === "same_person" && t.face_a && t.face_b ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FaceCrop item={toFaceItem(t.face_a)} className="rounded-lg" />
                      <p className="mt-1 truncate text-center text-xs text-muted-foreground">A</p>
                    </div>
                    <div>
                      <FaceCrop item={toFaceItem(t.face_b)} className="rounded-lg" />
                      <p className="mt-1 truncate text-center text-xs text-muted-foreground">B</p>
                    </div>
                    <div className="col-span-2 mt-2 flex justify-center gap-2">
                      <Button size="sm" onClick={() => decide(t.id, "yes")}>Yes same person</Button>
                      <Button size="sm" variant="outline" onClick={() => decide(t.id, "no")}>No</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{t.kind} · {t.face_a?.photos.file_name ?? t.id.slice(0, 8)}</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => decide(t.id, "yes")}>Yes</Button>
                      <Button size="sm" variant="outline" onClick={() => decide(t.id, "no")}>No</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
