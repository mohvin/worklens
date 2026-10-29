import { runFile } from "@/lib/runs";
import { downloadObject, getRunRow, supabaseConfigured } from "@/lib/supabase";

const IMMUTABLE = { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  if (!/^f\d+\.jpg$/.test(file)) return new Response("not found", { status: 404 });
  if (supabaseConfigured() && (await getRunRow(id, "id"))) {
    const r = await downloadObject("runs", `${id}/frames/${file}`);
    if (!r.ok) return new Response("not found", { status: 404 });
    return new Response(r.body, { headers: IMMUTABLE });
  }
  const buf = await runFile(id, `frames/${file}`);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: IMMUTABLE });
}
