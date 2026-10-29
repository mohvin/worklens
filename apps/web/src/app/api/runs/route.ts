import { randomBytes } from "node:crypto";
import { getProcessRow, insertRun, listRunsOfProcess, signedUploadUrl, supabaseConfigured } from "@/lib/supabase";

const MAX_BYTES = 500 * 1024 * 1024;
const TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

/** Create a run and hand the browser a one-off URL to upload the recording to. */
export async function POST(req: Request) {
  if (!supabaseConfigured()) return Response.json({ error: "Uploads are not configured on this deployment." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { filename?: string; size?: number; type?: string; process_id?: string; role?: string };
  const size = Number(body.size ?? 0);
  const type = String(body.type ?? "");
  if (!body.filename || !size) return Response.json({ error: "filename and size are required" }, { status: 400 });
  if (!TYPES.has(type)) return Response.json({ error: "Only MP4, MOV or WebM recordings are accepted." }, { status: 400 });
  if (size > MAX_BYTES) return Response.json({ error: "Recordings up to 500 MB." }, { status: 400 });
  const id = randomBytes(4).toString("hex");
  const safe = body.filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "recording.mp4";
  const role = String(body.role ?? "").trim().slice(0, 40) || null;
  let process_id: string | null = null, position = 0;
  if (body.process_id) {
    const p = await getProcessRow(String(body.process_id), "id");
    if (!p) return Response.json({ error: "That process no longer exists." }, { status: 400 });
    process_id = p.id;
    position = (await listRunsOfProcess(p.id, "id")).length;
  }
  await insertRun({ id, source: safe, size_bytes: size, process_id, role, position });
  const uploadUrl = await signedUploadUrl("uploads", `${id}/${safe}`);
  return Response.json({ id, uploadUrl, contentType: type });
}
