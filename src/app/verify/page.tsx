"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Nav } from "@/components/nav";

interface Task { id: string; kind: string; face_a_id: string; status: string; }

export default function VerifyPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/verification/tasks?status=pending&limit=20");
      const j = await r.json();
      setTasks(j.tasks ?? []);
    } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  const decide = async (id: string, decision: "yes"|"no") => {
    await fetch(`/api/verification/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    await load();
  };
  const generate = async () => {
    await fetch("/api/verification/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ faceNameLimit: 20 }) });
    await load();
  };
  return (
    <>
      <Nav active="verify" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Verify faces</h1>
          <Button variant="outline" onClick={generate}>Generate tasks</Button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">Flow 1: Same person? — 2 crops that might be same. Flow 2: Face = Name? — is this Unknown really this person? Uses glintr100 512d.</p>
        {loading ? <p className="text-sm">Loading...</p> : tasks.length===0 ? <p className="text-sm text-muted-foreground">No pending tasks. Click Generate.</p> : (
          <div className="space-y-3">
            {tasks.map(t => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">{t.kind} · {t.face_a_id.slice(0,8)}</span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(t.id, "yes")}>Yes same</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(t.id, "no")}>No</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
