// Server-only Supabase access with the service role key (never shipped to the browser).
import "server-only";

const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const KEY = process.env.SUPABASE_SERVICE_KEY ?? "";

export const supabaseConfigured = (): boolean => Boolean(URL_ && KEY);
export const supabaseUrl = (): string => URL_;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra };
}

export interface RunRow {
  id: string; source: string; size_bytes: number; status: string; progress: Record<string, unknown>;
  error: string | null; run_json: unknown | null; cost_usd: number; created_at: string; updated_at: string;
  process_id?: string | null; role?: string | null; position?: number;
}

export interface ProcessRow {
  id: string; name: string; status: "created" | "building" | "built" | "failed"; process_json: unknown | null;
  error: string | null; created_at: string; updated_at: string;
}

export async function getRunRow(id: string, select = "*"): Promise<RunRow | null> {
  if (!supabaseConfigured()) return null;
  const r = await fetch(`${URL_}/rest/v1/runs?id=eq.${encodeURIComponent(id)}&select=${select}`, { headers: headers(), cache: "no-store" });
  if (!r.ok) return null;
  const rows = (await r.json()) as RunRow[];
  return rows[0] ?? null;
}

export async function listRunRows(limit = 25): Promise<RunRow[]> {
  if (!supabaseConfigured()) return [];
  const r = await fetch(`${URL_}/rest/v1/runs?select=id,source,size_bytes,status,progress,error,cost_usd,created_at,updated_at,process_id,role,position&order=created_at.desc&limit=${limit}`, { headers: headers(), cache: "no-store" });
  return r.ok ? ((await r.json()) as RunRow[]) : [];
}

/** The runs of a process in handoff order, with run_json. */
export async function listRunsOfProcess(processId: string, select = "*"): Promise<RunRow[]> {
  if (!supabaseConfigured()) return [];
  const r = await fetch(`${URL_}/rest/v1/runs?process_id=eq.${encodeURIComponent(processId)}&select=${select}&order=position.asc,created_at.asc`, { headers: headers(), cache: "no-store" });
  return r.ok ? ((await r.json()) as RunRow[]) : [];
}

export async function getProcessRow(id: string, select = "*"): Promise<ProcessRow | null> {
  if (!supabaseConfigured()) return null;
  const r = await fetch(`${URL_}/rest/v1/processes?id=eq.${encodeURIComponent(id)}&select=${select}`, { headers: headers(), cache: "no-store" });
  if (!r.ok) return null;
  const rows = (await r.json()) as ProcessRow[];
  return rows[0] ?? null;
}

export async function listProcessRows(limit = 25): Promise<ProcessRow[]> {
  if (!supabaseConfigured()) return [];
  const r = await fetch(`${URL_}/rest/v1/processes?select=id,name,status,error,created_at,updated_at&order=created_at.desc&limit=${limit}`, { headers: headers(), cache: "no-store" });
  return r.ok ? ((await r.json()) as ProcessRow[]) : [];
}

export async function insertProcess(row: { id: string; name: string }): Promise<void> {
  const r = await fetch(`${URL_}/rest/v1/processes`, {
    method: "POST", headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }), body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insert process: ${r.status} ${await r.text()}`);
}

export async function updateProcess(id: string, fields: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${URL_}/rest/v1/processes?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }), body: JSON.stringify(fields),
  });
  if (!r.ok) throw new Error(`update process: ${r.status} ${await r.text()}`);
}

export async function insertRun(row: { id: string; source: string; size_bytes: number; process_id?: string | null; role?: string | null; position?: number }): Promise<void> {
  const r = await fetch(`${URL_}/rest/v1/runs`, {
    method: "POST", headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }), body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insert run: ${r.status} ${await r.text()}`);
}

export async function updateRun(id: string, fields: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${URL_}/rest/v1/runs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }), body: JSON.stringify(fields),
  });
  if (!r.ok) throw new Error(`update run: ${r.status} ${await r.text()}`);
}

/** A one-off URL the browser can PUT the file to; the service key never leaves the server. */
export async function signedUploadUrl(bucket: string, path: string): Promise<string> {
  const r = await fetch(`${URL_}/storage/v1/object/upload/sign/${bucket}/${path}`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: "{}" });
  if (!r.ok) throw new Error(`sign upload: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { url: string; token?: string };
  return `${URL_}/storage/v1${j.url}`;
}

export async function objectExists(bucket: string, path: string): Promise<boolean> {
  const r = await fetch(`${URL_}/storage/v1/object/info/${bucket}/${path}`, { headers: headers(), cache: "no-store" });
  return r.ok;
}

export async function downloadObject(bucket: string, path: string): Promise<Response> {
  return fetch(`${URL_}/storage/v1/object/${bucket}/${path}`, { headers: headers(), cache: "no-store" });
}
