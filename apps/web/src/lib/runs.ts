import { promises as fs } from "node:fs";
import path from "node:path";
import type { Run } from "./types";
import { SAMPLES } from "@/generated/samples";
import { getRunRow, listRunRows, supabaseConfigured } from "./supabase";

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
}

export interface RunListing { id: string; source: string; duration: number; status: string; findings: number; mtime: number; kind: Source }

const ID_RE = /^[a-z0-9_-]+$/i;

export async function listRuns(): Promise<RunListing[]> {
  const out: RunListing[] = Object.entries(SAMPLES).map(([id, s]) => ({
    id, source: s.run.source, duration: s.run.duration, status: s.run.status, findings: s.run.findings.length, mtime: s.mtime, kind: "sample",
  }));
  for (const row of await listRunRows()) {
    const p = row.progress as { steps?: number; findings?: number };
    out.push({ id: row.id, source: row.source, duration: 0, status: row.status, findings: p.findings ?? 0, mtime: Date.parse(row.updated_at), kind: "hosted" });
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
  if (s) return { run: s.run, pending: null, source: "sample", frameBase: `/samples/${id}/frames`, frames: s.frames };
  if (supabaseConfigured()) {
    const row = await getRunRow(id);
    if (row) {
      const frames = (row.progress as { frames_available?: number[] }).frames_available ?? null;
      if (row.status === "built" && row.run_json) {
        return { run: row.run_json as Run, pending: null, source: "hosted", frameBase: `/api/runs/${id}/frames`, frames, processedAt: new Date(row.updated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) };
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
