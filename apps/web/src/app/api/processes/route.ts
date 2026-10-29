import { randomBytes } from "node:crypto";
import { insertProcess, listProcessRows, supabaseConfigured } from "@/lib/supabase";

/** Processes the uploader can add a recording to. */
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ processes: [] });
  const rows = await listProcessRows(50);
  return Response.json({ processes: rows.map((r) => ({ id: r.id, name: r.name, status: r.status })) }, { headers: { "cache-control": "no-store" } });
}

/** Create an empty process; recordings are attached as they are uploaded. */
export async function POST(req: Request) {
  if (!supabaseConfigured()) return Response.json({ error: "Uploads are not configured on this deployment." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return Response.json({ error: "A process needs a name." }, { status: 400 });
  const id = randomBytes(4).toString("hex");
  await insertProcess({ id, name });
  return Response.json({ id, name });
}
