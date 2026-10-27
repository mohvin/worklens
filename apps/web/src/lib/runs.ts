import { promises as fs } from "node:fs";
import path from "node:path";
import type { Run } from "./types";
import { SAMPLES } from "@/generated/samples";

// Two sources: replay runs bundled from samples/runs (always present, also on
// Vercel), and the worker's local runs/<id> directory (dev, or a mounted volume).
export function runsDir(): string {
  return process.env.WORKLENS_RUNS_DIR ?? path.resolve(process.cwd(), "../../runs");
}

export interface LoadedRun {
  run: Run;
  sample: boolean;
  frameBase: string;           // URL prefix for frames
  frames: number[] | null;     // frame indexes that exist, or null when all do
}

export interface RunListing { id: string; source: string; duration: number; status: string; findings: number; mtime: number; sample: boolean }

const ID_RE = /^[a-z0-9_-]+$/i;

export async function listRuns(): Promise<RunListing[]> {
  const out: RunListing[] = Object.entries(SAMPLES).map(([id, s]) => ({
    id, source: s.run.source, duration: s.run.duration, status: s.run.status, findings: s.run.findings.length, mtime: s.mtime, sample: true,
  }));
  let entries: string[] = [];
  try { entries = await fs.readdir(runsDir()); } catch { entries = []; }
  for (const id of entries) {
    if (id in SAMPLES) continue;
    const loaded = await getRun(id);
    if (!loaded) continue;
    const st = await fs.stat(path.join(runsDir(), id, "run.json"));
    out.push({ id, source: loaded.run.source, duration: loaded.run.duration, status: loaded.run.status, findings: loaded.run.findings.length, mtime: st.mtimeMs, sample: false });
  }
  return out.sort((a, b) => (a.sample === b.sample ? b.mtime - a.mtime : a.sample ? -1 : 1));
}

export async function getRun(id: string): Promise<LoadedRun | null> {
  if (!ID_RE.test(id)) return null;
  const s = SAMPLES[id];
  if (s) return { run: s.run, sample: true, frameBase: `/samples/${id}/frames`, frames: s.frames };
  try {
    const text = await fs.readFile(path.join(runsDir(), id, "run.json"), "utf8");
    return { run: JSON.parse(text) as Run, sample: false, frameBase: `/api/runs/${id}/frames`, frames: null };
  } catch { return null; }
}

export async function runFile(id: string, rel: string): Promise<Buffer | null> {
  if (!ID_RE.test(id) || rel.includes("..")) return null;
  try { return await fs.readFile(path.join(runsDir(), id, rel)); } catch { return null; }
}
