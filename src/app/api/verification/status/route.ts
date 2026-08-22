import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 10;

export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { count, error } = await sb.from("verification_tasks").select("*", { count: "exact", head: true }).eq("status", "pending");
    if (error) throw new Error(error.message);
    return NextResponse.json({ pending: count ?? 0 });
  } catch (err) {
    return NextResponse.json({ pending: 0, error: err instanceof Error ? err.message : "failed" });
  }
}
