import Link from "next/link";
import { listProcesses, listRuns, runsDir } from "@/lib/runs";
import { supabaseConfigured } from "@/lib/supabase";
import { fmtClock, fmtSeconds } from "@/lib/types";
import Uploader from "@/components/Uploader";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { created: "waiting for recordings", building: "merging", built: "built", failed: "merge failed" };

const Ico = {
  runs: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" /></svg>,
  procs: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="5" rx="1.2" /><rect x="14" y="4" width="7" height="5" rx="1.2" /><rect x="8.5" y="15" width="7" height="5" rx="1.2" /><path d="M6.5 9v3h11V9M12 12v3" /></svg>,
  flag: <svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h12l-2 4 2 4H5" /></svg>,
  clock: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  upload: <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>,
  record: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></svg>,
  arrow: <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
};

export default async function Home() {
  const [runs, processes] = await Promise.all([listRuns(), listProcesses()]);
  const uploads = supabaseConfigured() && Boolean(process.env.WORKLENS_WORKER_URL);
  const built = runs.filter((r) => r.status === "built" || r.kind === "sample");
  const working = runs.filter((r) => r.kind !== "sample" && r.status !== "built" && r.status !== "failed");
  const failed = runs.filter((r) => r.status === "failed");
  const findings = runs.reduce((a, r) => a + r.findings, 0);
  const recorded = runs.reduce((a, r) => a + (r.duration || 0), 0);
  const attention = [
    ...failed.map((r) => ({ href: `/runs/${r.id}`, title: r.source, sub: "processing failed — open to see the log", tone: "fail" as const })),
    ...working.map((r) => ({ href: `/runs/${r.id}`, title: r.source, sub: `${r.status} — the worker is on it`, tone: "proc" as const })),
    ...processes.filter((p) => p.status !== "built").map((p) => ({ href: `/processes/${p.id}`, title: p.name, sub: p.status === "created" ? `${p.recs.length} recording${p.recs.length === 1 ? "" : "s"} so far — add the other roles` : STATUS[p.status] ?? p.status, tone: p.status === "failed" ? ("fail" as const) : ("proc" as const) })),
  ];

  return (
    <main className="page home">
      <div className="eyebrow">WorkLens / Overview</div>
      <div className="pagehead">
        <div>
          <h1 className="display">Work, as it actually happens.</h1>
          <div className="meta lead">Record a screen. Get the process, the timings, where it breaks — and what to fix.</div>
        </div>
        <div className="actions">
          <a className="btn" href="#runs">View runs</a>
          <a className="btn primary" href="#upload">{Ico.upload} New recording</a>
        </div>
      </div>

      <section className="hero" aria-label="How it works">
        <div className="hero-text">
          <div className="eyebrow">The process, from the screen</div>
          <h2 className="display">Every click, counted.<br />Every handoff, found.</h2>
          <p>One recording per role. WorkLens maps the steps, times the waits and loops, matches the handoffs on shared references, and proposes what to fix and where AI can take a step.</p>
        </div>
        <div className="hero-cards">
          <a className="hcard" href="#upload"><span className="hico">{Ico.upload}</span><b>Upload a recording</b><span>One role, one screen recording, any length {Ico.arrow}</span></a>
          <a className="hcard" href="https://github.com/mohvin/worklens/tree/main/apps/extension#readme" target="_blank" rel="noreferrer"><span className="hico">{Ico.record}</span><b>Record from the browser</b><span>Chrome extension, straight into a process {Ico.arrow}</span></a>
        </div>
      </section>

      <section className="tiles" aria-label="Workspace summary">
        <div className="tile"><div className="t-h">Runs<span className="tico">{Ico.runs}</span></div><div className="t-v">{String(runs.length).padStart(2, "0")}</div><div className="t-c">{built.length} built{working.length ? ` · ${working.length} processing` : ""}{failed.length ? ` · ${failed.length} failed` : ""}</div></div>
        <div className="tile"><div className="t-h">Processes<span className="tico">{Ico.procs}</span></div><div className="t-v">{String(processes.length).padStart(2, "0")}</div><div className="t-c">{processes.length ? `${processes.reduce((a, p) => a + p.recs.length, 0)} recordings across roles` : "merge recordings from several roles"}</div></div>
        <div className="tile"><div className="t-h">Findings<span className="tico">{Ico.flag}</span></div><div className="t-v">{String(findings).padStart(2, "0")}</div><div className="t-c"><span className="good">Loops, waits, re-keying</span> · across all runs</div></div>
        <div className="tile"><div className="t-h">Recorded<span className="tico">{Ico.clock}</span></div><div className="t-v">{recorded ? fmtClock(recorded) : "0:00"}</div><div className="t-c">screen time analysed · nothing read by a person</div></div>
      </section>

      <div className="home-cols">
        <div className="card attn">
          <div className="card-h"><h2>Needs your attention</h2><span className="n">{attention.length}</span><span className="spacer" /><a className="link" href="#runs">View all {Ico.arrow}</a></div>
          {attention.length === 0 ? <div className="empty">Nothing waiting. Every run is built and every process is merged.</div> : (
            <ul className="alist">{attention.slice(0, 6).map((a) => <li key={a.href}><Link href={a.href}><i className={a.tone} /><span><b>{a.title}</b><small>{a.sub}</small></span>{Ico.arrow}</Link></li>)}</ul>
          )}
        </div>
        <div className="card how">
          <div className="card-h"><h2>The pipeline</h2><span className="hint">five stages, one recording</span></div>
          <ol className="stages">
            {[["Sample", "frames at 1 fps"], ["Detect", "pixel-diff + SAM 3.1"], ["Label", "Muse Spark names each step"], ["Graph", "steps, loops, waits, handoffs"], ["Recommend", "fix the process · apply AI"]].map(([t, s], i) => <li key={t}><span className="no">{String(i + 1).padStart(2, "0")}</span><b>{t}</b><small>{s}</small></li>)}
          </ol>
        </div>
      </div>

      <section id="upload" className="up-sec">
        <div className="section-h">New recording <span>upload a screen recording; name the role if it belongs to a process</span></div>
        <Uploader enabled={uploads} processes={processes.map((p) => ({ id: p.id, name: p.name, status: p.status }))} />
      </section>

      {processes.length > 0 && (
        <section id="processes">
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
        </section>
      )}

      <section id="runs">
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
      </section>
      <footer className="foot"><span>WorkLens · PurpleAI Labs · Meta Global AI Developer Hackathon 2026</span></footer>
    </main>
  );
}
