import Link from "next/link";
import { listProcesses, listRuns, runsDir } from "@/lib/runs";
import { supabaseConfigured } from "@/lib/supabase";
import { fmtSeconds } from "@/lib/types";
import Uploader from "@/components/Uploader";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [runs, processes] = await Promise.all([listRuns(), listProcesses()]);
  const STATUS: Record<string, string> = { created: "waiting for recordings", building: "merging", built: "built", failed: "merge failed" };
  return (
    <main className="page">
      <div className="pagehead">
        <div>
          <h1>Runs</h1>
          <div className="meta">A run turns one screen recording into a process map, timings and findings. Nothing in the recording is read by a person.</div>
        </div>
      </div>
      <Uploader enabled={supabaseConfigured() && Boolean(process.env.WORKLENS_WORKER_URL)} processes={processes.map((p) => ({ id: p.id, name: p.name, status: p.status }))} />
      {processes.length > 0 && (
        <>
          <div className="section-h">Processes <span>several recordings, one per role, merged into one map with the handoffs between them</span></div>
          <ul className="runlist card">
            {processes.map((p) => (
              <li key={p.id}>
                <Link href={`/processes/${p.id}`}>
                  <span><b>{p.name}</b><span className="id">{p.id}</span></span>
                  <span style={{ color: "var(--text-2)" }}>{p.recs.length ? p.recs.map((r) => r.role || r.source).join(" → ") : "no recordings yet"}</span>
                  <span>{p.recs.length} recording{p.recs.length === 1 ? "" : "s"}</span>
                  <span className={`chip ${p.status === "built" ? "ok" : p.status === "failed" ? "fail" : "proc"}`}>{STATUS[p.status] ?? p.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="section-h">Recent runs <span>the replay sample is a real run checked into the repo; your uploads appear below it</span></div>
      {runs.length === 0 ? (
        <div className="card empty">
          <p style={{ marginTop: 0 }}>No runs yet. Process a recording with the worker and it appears here:</p>
          <pre>worklens run samples/synthetic-invoice.mp4</pre>
          <p style={{ marginBottom: 0 }}>Reading from <code>{runsDir()}</code>. Set <code>WORKLENS_RUNS_DIR</code> to change it.</p>
        </div>
      ) : (
        <ul className="runlist card">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/runs/${r.id}`}>
                <span><b>{r.source}</b><span className="id">{r.id}</span>{r.role && <span className="chip" style={{ marginLeft: 8 }}>{r.role}</span>}</span>
                <span>{r.duration ? fmtSeconds(r.duration) : ""}</span>
                <span>{r.findings} finding{r.findings === 1 ? "" : "s"}</span>
                <span className={`chip ${r.status === "built" ? "ok" : r.status === "failed" ? "fail" : r.kind === "sample" ? "ok" : "proc"}`}>{r.kind === "sample" ? "Replay sample" : r.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <footer className="foot"><span>WorkLens · PurpleAI Labs · Meta Global AI Developer Hackathon 2026</span></footer>
    </main>
  );
}
