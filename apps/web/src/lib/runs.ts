import { promises as fs } from "node:fs";
import path from "node:path";
import type { Run } from "./types";

// The worker writes runs/<id>/run.json next to frames/. Point WORKLENS_RUNS_DIR
// at that directory; the default is the repo's ./runs when running from apps/web.
export function runsDir(): string {
  return process.env.WORKLENS_RUNS_DIR ?? path.resolve(process.cwd(), "../../runs");
}

export interface RunListing { id: string; source: string; duration: number; status: string; findings: number; mtime: number }

export async function listRuns(): Promise<RunListing[]> {
  let entries: string[] = [];
  try { entries = await fs.readdir(runsDir()); } catch { return []; }
  const out: RunListing[] = [];
  for (const id of entries) {
    const run = await getRun(id);
    if (!run) continue;
    const st = await fs.stat(path.join(runsDir(), id, "run.json"));
    out.push({ id, source: run.source, duration: run.duration, status: run.status, findings: run.findings.length, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function getRun(id: string): Promise<Run | null> {
  if (!/^[a-z0-9_-]+$/i.test(id)) return null;
  try {
    const text = await fs.readFile(path.join(runsDir(), id, "run.json"), "utf8");
    return JSON.parse(text) as Run;
  } catch { return null; }
}

export async function runFile(id: string, rel: string): Promise<Buffer | null> {
  if (!/^[a-z0-9_-]+$/i.test(id) || rel.includes("..")) return null;
  try { return await fs.readFile(path.join(runsDir(), id, rel)); } catch { return null; }
}
