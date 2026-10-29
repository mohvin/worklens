import { getRunRow, supabaseConfigured, updateRun } from "@/lib/supabase";

interface Entry { t: number; host: string; title: string; reason?: string }

/** The browser extension posts the tab log it kept while recording. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const row = await getRunRow(id, "id");
  if (!row) return Response.json({ error: "no such run" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { entries?: unknown };
  const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 2000).flatMap((e): Entry[] => {
    if (!e || typeof e !== "object") return [];
    const x = e as Record<string, unknown>;
    return [{ t: Math.max(0, Number(x.t) || 0), host: String(x.host ?? "").slice(0, 200), title: String(x.title ?? "").slice(0, 200), reason: typeof x.reason === "string" ? x.reason.slice(0, 20) : undefined }];
  });
  await updateRun(id, { tab_log: entries });
  return Response.json({ ok: true, entries: entries.length });
}
