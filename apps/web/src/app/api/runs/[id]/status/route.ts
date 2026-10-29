import { getRunRow, supabaseConfigured } from "@/lib/supabase";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const row = await getRunRow(id, "id,status,progress,error,updated_at");
  if (!row) return Response.json({ error: "no such run" }, { status: 404 });
  return Response.json({ status: row.status, progress: row.progress, error: row.error, updated_at: row.updated_at }, { headers: { "cache-control": "no-store" } });
}
