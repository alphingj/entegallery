"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/nav";
import { FaceCrop } from "@/components/face-crop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { bulkDecide, fetchBulkPending, type BulkGroup } from "@/lib/api-client";

function PersonAutocomplete({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!value || value.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/people?q=${encodeURIComponent(value)}`);
        const j = await r.json();
        setSuggestions(j.people?.map((p: { name: string }) => p.name) ?? []);
      } catch {}
    }, 200);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setShow(true); }}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 200)}
        placeholder="Type name..."
        disabled={disabled}
      />
      {show && suggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 rounded-md border bg-popover p-1 shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((name) => (
            <button
              key={name}
              onClick={() => { onChange(name); setShow(false); }}
              className="w-full px-2 py-1 text-sm hover:bg-accent text-left"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BulkGroupCard({ 
  group, 
  onConfirm, 
  onReject, 
  onSkip 
}: { 
  group: { 
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
  onConfirm: (personId: string | null, newName?: string) => void;
  onReject: () => void;
  onSkip: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [newName, setNewName] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted">
            <img 
              src={group.representativeFace.thumbnailUrl ?? "/placeholder.jpg"} 
              alt={group.personName} 
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <p className="font-medium text-sm">{group.personName || "New Person"}</p>
            <p className="text-xs text-muted-foreground">{group.faceCount} photo{group.faceCount !== 1 ? "s" : ""}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode("existing")}
            className={`px-3 py-1.5 text-sm rounded-md border ${
              group.personId ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
            }`}
            disabled={false}
          >
            Add to existing
          </button>
          <button
            onClick={() => setMode("new")}
            className="px-3 py-1.5 text-sm rounded-md border"
          >
            New person
          </button>
        </div>

        {mode === "existing" && (
          <select
            value={selectedPersonId}
            onChange={(e) => setSelectedPersonId(e.target.value)}
            className="w-full rounded-md border p-2 text-sm"
            disabled={false}
          >
            <option value="">Select existing person...</option>
            {/* This would be populated from an API call in a real implementation */}
          </select>
        )}

        {mode === "new" && (
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Enter new name"
            autoFocus
          />
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="destructive" size="sm" onClick={() => onSkip()} className="flex-1">
            Skip
          </Button>
          <Button variant="outline" size="sm" onClick={() => onReject()} className="flex-1">
            Reject
          </Button>
          <Button size="sm" onClick={() => onConfirm(mode === "existing" ? selectedPersonId || null : null, mode === "new" ? newName : undefined)} className="flex-1 bg-primary text-primary-foreground">
            {group.personId ? "Confirm" : "Create & Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function BulkVerifyPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<{ 
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
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skipSessionId] = useState(() => `skip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

  const load = async () => {
    try {
      const res = await fetch("/api/verification/bulk-pending?limit=200");
      const data = await res.json();
      setGroups(data.groups || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleConfirm = async (group: typeof groups[0], newName?: string) => {
    const decisions = group.faces.map(face => ({
      faceId: face.faceId,
      decision: "confirm" as const,
      correctPersonId: group.personId || undefined,
      newName: group.personId ? undefined : newName
    }));

    try {
      await fetch("/api/verification/bulk-decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions })
      });
      toast.success(`Confirmed ${group.faceCount} face${group.faceCount > 1 ? "s" : ""}`);
      setGroups(prev => prev.filter(g => g !== group));
    } catch (err) {
      toast.error("Failed to confirm");
    }
  };

  const handleReject = async (group: typeof groups[0]) => {
    const decisions = group.faces.map(face => ({
      faceId: face.faceId,
      decision: "reject" as const
    }));

    try {
      await fetch("/api/verification/bulk-decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions })
      });
      toast.success(`Rejected ${group.faceCount} face${group.faceCount > 1 ? "s" : ""}`);
      setGroups(prev => prev.filter(g => g !== group));
    } catch (err) {
      toast.error("Failed to reject");
    }
  };

  const handleSkip = async (group: typeof groups[0]) => {
    const decisions = group.faces.map(face => ({
      faceId: face.faceId,
      decision: "skip" as const
    }));

    try {
      await fetch("/api/verification/bulk-decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions })
      });
      toast.success(`Skipped ${group.faceCount} face${group.faceCount > 1 ? "s" : ""}`);
      setGroups(prev => prev.filter(g => g !== group));
    } catch (err) {
      toast.error("Failed to skip");
    }
  };

  return (
    <>
      <Nav active="verify" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Bulk Name Entry</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {groups.reduce((sum, g) => sum + g.faceCount, 0)} faces in {groups.length} group{groups.length !== 1 ? "s" : ""}
            </span>
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
              All faces have been identified or there are no new faces to process.
            </p>
            <button onClick={load} className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">
              Refresh
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {groups.map((group) => (
              <div 
                key={group.personId || `new_${group.faces[0].faceId}`}
                className="group relative overflow-hidden rounded-lg border bg-card bg-white/5"
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <img
                    src={group.representativeFace.thumbnailUrl || "/placeholder.jpg"}
                    alt={group.personName}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-center p-2">
                    <div className="flex gap-1 w-full justify-center">
                      <button
                        onClick={() => handleConfirm(group)}
                        className="px-3 py-1.5 text-xs font-medium rounded-full bg-green-600 text-white hover:bg-green-700 transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => handleReject(group)}
                        className="px-3 py-1.5 text-xs font-medium rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleSkip(group)}
                        className="px-3 py-1.5 text-xs font-medium rounded-full bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">{group.personName || "New Person"}</p>
                    <span className="text-xs text-muted-foreground">{group.faceCount} photo{group.faceCount > 1 ? "s" : ""}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}