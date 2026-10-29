import { getRunRow, objectExists, supabaseConfigured, updateRun } from "@/lib/supabase";

/** The upload finished: mark the run queued and ask the worker to process it. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const row = await getRunRow(id, "id,source,status");
  if (!row) return Response.json({ error: "no such run" }, { status: 404 });
  if (!(await objectExists("uploads", `${id}/${row.source}`))) return Response.json({ error: "The upload did not arrive." }, { status: 409 });
  const url = process.env.WORKLENS_WORKER_URL;
  const secret = process.env.WORKLENS_WORKER_SECRET;
  if (!url || !secret) return Response.json({ error: "Worker is not configured on this deployment." }, { status: 503 });
  await updateRun(id, { status: "queued", error: null });
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: id, secret }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok || !j.ok) {
    await updateRun(id, { status: "failed", error: `worker: ${j.error ?? r.status}` });
    return Response.json({ error: j.error ?? `worker returned ${r.status}` }, { status: 502 });
  }
  return Response.json({ ok: true });
}
