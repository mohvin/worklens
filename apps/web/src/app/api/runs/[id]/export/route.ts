import { getRun, runFile } from "@/lib/runs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const fmt = new URL(req.url).searchParams.get("format") ?? "json";
  const loaded = await getRun(id);
  if (!loaded) return new Response("not found", { status: 404 });
  const base = loaded.run.source.replace(/\.[^.]+$/, "");
  if (fmt === "bpmn") {
    if (loaded.sample) return Response.redirect(new URL(`/samples/${id}/run.bpmn`, req.url), 302);
    const xml = await runFile(id, "run.bpmn");
    if (!xml) return new Response("run.bpmn not built yet: run `worklens rebuild " + id + "`", { status: 404 });
    return new Response(new Uint8Array(xml), { headers: { "content-type": "application/xml", "content-disposition": `attachment; filename="${base}.bpmn"` } });
  }
  return new Response(JSON.stringify(loaded.run, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${base}.worklens.json"` } });
}
