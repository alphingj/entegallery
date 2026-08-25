// @ts-nocheck — Deno Edge Function, not checked by Next.js (excluded in tsconfig)
// Supabase Edge Function proxy — keeps SERVICE_ROLE_KEY server-side
// Deploy: supabase functions deploy face-backfill --no-verify-jwt
// Then Android calls POST https://<project>.supabase.co/functions/v1/face-backfill with header x-app-token

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Reuse same threshold logic as src/lib/face-matcher.ts:54
const THRESHOLD = parseFloat(Deno.env.get("FACE_THRESHOLD") ?? "0.28");
const MARGIN = parseFloat(Deno.env.get("FACE_MARGIN") ?? "0.06");
const FLOOR = parseFloat(Deno.env.get("FACE_FLOOR") ?? "0.20");

Deno.serve(async (req) => {
  if (req.headers.get("x-app-token") !== Deno.env.get("APP_TOKEN")) {
    return new Response("unauthorized", { status: 401 });
  }
  const { photo_id, faces, width, height } = await req.json() as {
    photo_id: string; faces: { descriptor: number[]; box: {x:number,y:number,width:number,height:number}}[]; width?: number; height?: number
  };
  if (!photo_id || !Array.isArray(faces)) return new Response("bad request", { status: 400 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Validate 512d
  const valid = faces.filter(f => Array.isArray(f.descriptor) && f.descriptor.length===512 && f.box && typeof f.box.x==="number");

  // Batch rpc like face-matcher.ts:64
  const candidateLists: any[][] = await Promise.all(valid.map(async (f: any) => {
    const { data, error } = await sb.rpc("match_person_top2", { q: f.descriptor, max_dist: THRESHOLD });
    if (error) throw new Error(error.message);
    return data ?? [];
  }));

  for (let i=0;i<valid.length;i++) {
    const [best, second] = candidateLists[i];
    let personId: string;
    if (best && (best.distance < FLOOR || !second || second.distance - best.distance >= MARGIN)) {
      personId = best.person_id;
    } else {
      const { data, error } = await sb.from("people").insert({ name: "Unknown", descriptor: valid[i].descriptor }).select("id").single();
      if (error) throw new Error(error.message);
      personId = data.id;
    }
    const { error } = await sb.from("photo_faces").insert({
      photo_id, person_id, bounding_box: valid[i].box, descriptor: valid[i].descriptor
    });
    if (error) throw new Error(error.message);
  }

  if (typeof width==="number") await sb.from("photos").update({ width, height, face_scan_status: "done" }).eq("id", photo_id);
  else await sb.from("photos").update({ face_scan_status: "done" }).eq("id", photo_id);

  return new Response(JSON.stringify({ ok: true, faces: valid.length }), { headers: { "content-type":"application/json" } });
});
