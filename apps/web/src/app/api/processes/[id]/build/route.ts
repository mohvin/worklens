import { getProcessRow, supabaseConfigured, updateProcess } from "@/lib/supabase";

/** Ask the worker to (re)merge the process's built recordings. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const row = await getProcessRow(id, "id,status");
  if (!row) return Response.json({ error: "no such process" }, { status: 404 });
  const url = process.env.WORKLENS_WORKER_URL;
  const secret = process.env.WORKLENS_WORKER_SECRET;
  if (!url || !secret) return Response.json({ error: "Worker is not configured on this deployment." }, { status: 503 });
  await updateProcess(id, { status: "building", error: null });
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ process_id: id, secret }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok || !j.ok) {
    await updateProcess(id, { status: "failed", error: `worker: ${j.error ?? r.status}` });
    return Response.json({ error: j.error ?? `worker returned ${r.status}` }, { status: 502 });
  }
  return Response.json({ ok: true });
}
