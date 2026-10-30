import { getRunRow, supabaseConfigured } from "@/lib/supabase";
import { callWorker } from "@/lib/worker";

const STATUSES = new Set(["proposed", "accepted", "rejected", "done"]);

/** Record a decision on one recommendation; the worker recomputes the numbers (no model call) and we return the fresh set. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { item_id?: string; status?: string; decided_by?: string; note?: string };
  if (!body.item_id || !body.status || !STATUSES.has(body.status)) return Response.json({ error: "item_id and a valid status are required" }, { status: 400 });
  try {
    await callWorker({ decide: { kind: "run", id, item_id: body.item_id, status: body.status, decided_by: (body.decided_by ?? "").slice(0, 80) || null, note: (body.note ?? "").slice(0, 500) || null } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const row = await getRunRow(id, "id,recommendations_json");
  return Response.json({ ok: true, recommendations: row?.recommendations_json ?? null }, { headers: { "cache-control": "no-store" } });
}

/** (Re)generate the recommendations in the background; earlier decisions are kept by item id. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  try {
    await callWorker({ recommend: { kind: "run", id } });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const row = await getRunRow(id, "id,recommendations_json");
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  if (new URL(req.url).searchParams.get("download")) {
    return new Response(JSON.stringify(row.recommendations_json ?? null, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${id}.recommendations.json"` } });
  }
  return Response.json({ recommendations: row.recommendations_json ?? null }, { headers: { "cache-control": "no-store" } });
}
