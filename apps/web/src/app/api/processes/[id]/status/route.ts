import { getProcessRow, listRunsOfProcess, supabaseConfigured } from "@/lib/supabase";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const row = await getProcessRow(id, "id,status,error,updated_at");
  if (!row) return Response.json({ error: "no such process" }, { status: 404 });
  const runs = await listRunsOfProcess(id, "id,role,source,status,error");
  return Response.json({ status: row.status, error: row.error, updated_at: row.updated_at, recordings: runs.map((r) => ({ id: r.id, role: r.role, source: r.source, status: r.status, error: r.error })) }, { headers: { "cache-control": "no-store" } });
}
