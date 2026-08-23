"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Nav } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fetchPeople, type PersonSummary } from "@/lib/api-client";

type BulkGroup = {
  personId: string | null;
  personName: string;
  faceCount: number;
  representativeFace: {
    faceId: string;
    thumbnailUrl: string | null;
    box: { x: number; y: number; width: number; height: number };
    width: number | null;
    height: number | null;
  };
  faces: Array<{
    faceId: string;
    thumbnailUrl: string | null;
    box: { x: number; y: number; width: number; height: number };
    width: number | null;
    height: number | null;
  }>;
};

export default function BulkVerifyPage() {
  const [groups, setGroups] = useState<BulkGroup[]>([]);
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newNames, setNewNames] = useState<Record<string, string>>({});
  const [pickPerson, setPickPerson] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [bulkRes, peopleRes] = await Promise.all([
        fetch("/api/verification/bulk-pending?limit=200").then((r) => r.json()),
        fetchPeople().catch(() => ({ people: [] as PersonSummary[] })),
      ]);
      setGroups(bulkRes.groups || []);
      setPeople((peopleRes as { people: PersonSummary[] }).people ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const groupKey = (g: BulkGroup) => g.personId ?? `new_${g.faces[0]?.faceId ?? "unknown"}`;

  const handleDecision = async (group: BulkGroup, decision: "confirm" | "reject" | "skip", opts?: { personId?: string | null; newName?: string }) => {
    const key = groupKey(group);
    setSavingId(key);
    const decisions = group.faces.map((face) => {
      if (decision === "confirm") {
        const pid = opts?.personId ?? group.personId ?? undefined;
        const nn = !pid ? (opts?.newName ?? newNames[key] ?? undefined) : undefined;
        if (!pid && !nn?.trim()) return null;
        return { faceId: face.faceId, decision: "confirm" as const, correctPersonId: pid ?? undefined, newName: nn?.trim() || undefined };
      }
      return { faceId: face.faceId, decision };
    }).filter(Boolean) as { faceId: string; decision: "confirm" | "reject" | "skip"; correctPersonId?: string; newName?: string }[];

    if (decisions.length === 0) {
      toast.error(decision === "confirm" ? "Enter a name or pick a person" : "No faces");
      setSavingId(null);
      return;
    }

    try {
      const res = await fetch("/api/verification/bulk-decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "failed");
      toast.success(`${decision === "confirm" ? "Confirmed" : decision === "reject" ? "Rejected" : "Skipped"} ${group.faceCount} face${group.faceCount > 1 ? "s" : ""}`);
      setGroups((prev) => prev.filter((g) => groupKey(g) !== key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingId(null);
    }
  };

  const runGenerate = async () => {
    // Bulk groups are live from Unknown faces — no verification_tasks needed.
    // Generate here just refreshes groups and also warms verification tasks for Swipe/Verify.
    setLoading(true);
    try {
      const gen = await fetch("/api/verification/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceNameLimit: 50, samePersonLimit: 30 }),
      })
        .then((r) => r.json().catch(() => ({})))
        .catch(() => ({}));
      await load();
      if (gen?.createdFaceName !== undefined) {
        toast.success(`Refreshed · ${groups.length} groups · +${gen.createdFaceName ?? 0} verification tasks`);
      } else {
        toast.success("Refreshed");
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to generate");
      setLoading(false);
    }
  };

  const namedPeople = people.filter((p) => p.name !== "Unknown");

  return (
    <>
      <Nav active="verify" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="min-h-9">
              <Link href="/verify">
                <ArrowLeft className="mr-1.5 size-4" /> Back
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">Bulk Name Entry</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {groups.reduce((sum, g) => sum + g.faceCount, 0)} faces in {groups.length} group{groups.length !== 1 ? "s" : ""}
            </span>
            <Button onClick={runGenerate} disabled={loading} variant="outline" size="sm">
              Generate
            </Button>
            <Button onClick={load} disabled={loading} variant="outline" size="sm">
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <h2 className="text-lg font-semibold">No faces to identify</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              All faces have been identified or there are no new faces to process. Tap Generate to group Unknowns by best match.
            </p>
            <div className="flex gap-2 mt-4">
              <Button onClick={runGenerate} disabled={loading} size="sm">
                Generate
              </Button>
              <Button onClick={load} disabled={loading} variant="outline" size="sm">
                Refresh
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => {
              const key = groupKey(group);
              const isNew = !group.personId;
              const busy = savingId === key;
              return (
                <div key={key} className="rounded-xl border p-4 space-y-3 bg-card">
                  <div className="flex items-center gap-3">
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={group.representativeFace.thumbnailUrl ?? "/placeholder.jpg"}
                        alt={group.personName}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{group.personName || "New Person"}</p>
                      <p className="text-xs text-muted-foreground">
                        {group.faceCount} photo{group.faceCount !== 1 ? "s" : ""} · best match {isNew ? "none" : "found"}
                      </p>
                    </div>
                  </div>

                  {isNew ? (
                    <div className="space-y-2">
                      <Input
                        value={newNames[key] ?? ""}
                        onChange={(e) => setNewNames((m) => ({ ...m, [key]: e.target.value }))}
                        placeholder="Enter name for this group"
                        disabled={busy}
                      />
                      {namedPeople.length > 0 && (
                        <Select value={pickPerson[key] ?? ""} onValueChange={(v) => setPickPerson((m) => ({ ...m, [key]: v }))}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Or pick existing person…" />
                          </SelectTrigger>
                          <SelectContent>
                            {namedPeople.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} · {p.photoCount} photos
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Will assign to <span className="font-medium text-foreground">{group.personName}</span>
                      {namedPeople.length > 1 && " · or pick another below"}
                    </p>
                  )}

                  {!isNew && namedPeople.length > 0 && (
                    <Select value={pickPerson[key] ?? ""} onValueChange={(v) => setPickPerson((m) => ({ ...m, [key]: v }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={`Keep as ${group.personName} or reassign…`} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={group.personId!}>{group.personName} (suggested)</SelectItem>
                        {namedPeople
                          .filter((p) => p.id !== group.personId)
                          .map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} · {p.photoCount} photos
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        handleDecision(group, "confirm", {
                          personId: pickPerson[key] || group.personId,
                          newName: !pickPerson[key] && isNew ? newNames[key] : undefined,
                        })
                      }
                      className="flex-1"
                    >
                      Confirm
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => handleDecision(group, "reject")} className="flex-1">
                      Reject
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleDecision(group, "skip")} className="flex-1">
                      Skip
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-1 pt-1">
                    {group.faces.slice(0, 6).map((f) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={f.faceId}
                        src={f.thumbnailUrl ?? "/placeholder.jpg"}
                        alt=""
                        className="size-8 rounded object-cover border"
                        loading="lazy"
                      />
                    ))}
                    {group.faces.length > 6 && <span className="text-xs text-muted-foreground self-center">+{group.faces.length - 6}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
