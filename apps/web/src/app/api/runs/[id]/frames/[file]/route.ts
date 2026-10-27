import { runFile } from "@/lib/runs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  if (!/^f\d+\.jpg$/.test(file)) return new Response("not found", { status: 404 });
  const buf = await runFile(id, `frames/${file}`);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}
