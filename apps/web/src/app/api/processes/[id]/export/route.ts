import { downloadObject, getProcessRow, supabaseConfigured } from "@/lib/supabase";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const fmt = new URL(req.url).searchParams.get("format") ?? "json";
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const row = await getProcessRow(id);
  if (!row || row.status !== "built") return Response.json({ error: "process not built yet" }, { status: 404 });
  if (fmt === "bpmn") {
    const r = await downloadObject("runs", `processes/${id}/process.bpmn`);
    if (!r.ok) return Response.json({ error: "no BPMN file for this process yet" }, { status: 404 });
    return new Response(await r.arrayBuffer(), { headers: { "content-type": "application/xml", "content-disposition": `attachment; filename="${id}.bpmn"` } });
  }
  return new Response(JSON.stringify(row.process_json, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${id}.process.json"` } });
}
