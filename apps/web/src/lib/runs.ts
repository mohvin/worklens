import { promises as fs } from "node:fs";
import path from "node:path";
import type { Process, Recommendations, Run } from "./types";
import { SAMPLES } from "@/generated/samples";
import { getProcessRow, getRunRow, listProcessRows, listRunRows, listRunsOfProcess, supabaseConfigured, type ProcessRow } from "./supabase";

// Three sources, in this order: replay runs bundled from samples/runs (always
// present, also on Vercel), runs uploaded through the site (Supabase row +
// storage), and the worker's local runs/<id> directory (dev).
export function runsDir(): string {
  return process.env.WORKLENS_RUNS_DIR ?? path.resolve(process.cwd(), "../../runs");
}

export type Source = "sample" | "hosted" | "local";

export interface Pending { status: string; progress: Record<string, unknown>; error: string | null; source_name: string; created_at: string }

export interface LoadedRun {
  run: Run | null;             // null while a hosted run is still processing (see pending)
  pending: Pending | null;
  source: Source;
  frameBase: string;           // URL prefix for frames
  frames: number[] | null;     // frame indexes that exist, or null when all do
  processedAt?: string;        // hosted runs: when the pipeline finished
  process?: { id: string; name: string; role: string | null } | null;   // hosted runs that belong to a process
  recs?: Recommendations | null;                                        // recommendations, when generated
  role?: string | null;
}

export interface RunListing { id: string; source: string; duration: number; status: string; findings: number; mtime: number; kind: Source; role?: string | null; processId?: string | null }

const ID_RE = /^[a-z0-9_-]+$/i;

export async function listRuns(): Promise<RunListing[]> {
  const out: RunListing[] = Object.entries(SAMPLES).map(([id, s]) => ({
    id, source: s.run.source, duration: s.run.duration, status: s.run.status, findings: s.run.findings.length, mtime: s.mtime, kind: "sample",
  }));
  for (const row of await listRunRows()) {
    const p = row.progress as { steps?: number; findings?: number };
    out.push({ id: row.id, source: row.source, duration: 0, status: row.status, findings: p.findings ?? 0, mtime: Date.parse(row.updated_at), kind: "hosted", role: row.role ?? null, processId: row.process_id ?? null });
  }
  let entries: string[] = [];
  try { entries = await fs.readdir(runsDir()); } catch { entries = []; }
  for (const id of entries) {
    if (id in SAMPLES) continue;
    const loaded = await loadLocal(id);
    if (!loaded?.run) continue;
    const st = await fs.stat(path.join(runsDir(), id, "run.json"));
    out.push({ id, source: loaded.run.source, duration: loaded.run.duration, status: loaded.run.status, findings: loaded.run.findings.length, mtime: st.mtimeMs, kind: "local" });
  }
  const rank: Record<Source, number> = { sample: 0, hosted: 1, local: 2 };
  return out.sort((a, b) => (a.kind === b.kind ? b.mtime - a.mtime : rank[a.kind] - rank[b.kind]));
}

async function loadLocal(id: string): Promise<LoadedRun | null> {
  try {
    const text = await fs.readFile(path.join(runsDir(), id, "run.json"), "utf8");
    return { run: JSON.parse(text) as Run, pending: null, source: "local", frameBase: `/api/runs/${id}/frames`, frames: null };
  } catch { return null; }
}

export async function getRun(id: string): Promise<LoadedRun | null> {
  if (!ID_RE.test(id)) return null;
  const s = SAMPLES[id];
  if (s) return { run: s.run, pending: null, source: "sample", frameBase: `/samples/${id}/frames`, frames: s.frames, recs: s.recs ?? null };
  if (supabaseConfigured()) {
    const row = await getRunRow(id);
    if (row) {
      const frames = (row.progress as { frames_available?: number[] }).frames_available ?? null;
      let process: LoadedRun["process"] = null;
      if (row.process_id) {
        const pr = await getProcessRow(row.process_id, "id,name");
        if (pr) process = { id: pr.id, name: pr.name, role: row.role ?? null };
      }
      if (row.status === "built" && row.run_json) {
        return { run: row.run_json as Run, pending: null, source: "hosted", frameBase: `/api/runs/${id}/frames`, frames, processedAt: new Date(row.updated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }), process, recs: (row.recommendations_json as Recommendations | null) ?? null, role: row.role ?? null };
      }
      return {
        run: null,
        pending: { status: row.status, progress: row.progress, error: row.error, source_name: row.source, created_at: row.created_at },
        source: "hosted", frameBase: `/api/runs/${id}/frames`, frames,
      };
    }
  }
  return loadLocal(id);
}

export async function runFile(id: string, rel: string): Promise<Buffer | null> {
  if (!ID_RE.test(id) || rel.includes("..")) return null;
  try { return await fs.readFile(path.join(runsDir(), id, rel)); } catch { return null; }
}

// ---- processes: several hosted runs, one per role ----

export interface ProcessRec { id: string; role: string; source: string; status: string; error: string | null; run: Run | null; frameBase: string; frames: number[] | null }
export interface LoadedProcess { row: ProcessRow; proc: Process | null; recs: ProcessRec[]; recommendations: Recommendations | null }

export async function getProcess(id: string): Promise<LoadedProcess | null> {
  if (!ID_RE.test(id) || !supabaseConfigured()) return null;
  const row = await getProcessRow(id);
  if (!row) return null;
  const rows = await listRunsOfProcess(id);
  const recs: ProcessRec[] = rows.map((r) => ({
    id: r.id, role: r.role ?? "", source: r.source, status: r.status, error: r.error,
    run: r.status === "built" && r.run_json ? (r.run_json as Run) : null,
    frameBase: `/api/runs/${r.id}/frames`, frames: (r.progress as { frames_available?: number[] }).frames_available ?? null,
  }));
  return { row, proc: row.status === "built" && row.process_json ? (row.process_json as Process) : null, recs, recommendations: (row.recommendations_json as Recommendations | null) ?? null };
}

export interface ProcessListing { id: string; name: string; status: string; mtime: number; recs: { id: string; role: string; source: string; status: string }[] }

export async function listProcesses(): Promise<ProcessListing[]> {
  const rows = await listProcessRows();
  if (rows.length === 0) return [];
  const runs = await listRunRows(200);
  return rows.map((p) => ({
    id: p.id, name: p.name, status: p.status, mtime: Date.parse(p.updated_at),
    recs: runs.filter((r) => r.process_id === p.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at.localeCompare(b.created_at)).map((r) => ({ id: r.id, role: r.role ?? "", source: r.source, status: r.status })),
  }));
}
