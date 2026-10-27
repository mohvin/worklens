import Link from "next/link";
import { listRuns, runsDir } from "@/lib/runs";
import { fmtSeconds } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const runs = await listRuns();
  return (
    <main className="wrap">
      <div className="runhead">
        <h1>Runs</h1>
        <div className="facts"><span>Each run is one screen recording turned into a process map.</span></div>
      </div>
      {runs.filter((r) => !r.sample).length === 0 && runs.length > 0 && (
        <p style={{ color: "var(--ink-2)", margin: "0 0 14px", maxWidth: "64ch" }}>
          The replay sample below is a real run checked into the repo. Process your own recording with <code>worklens run recording.mp4</code> and it appears here.
        </p>
      )}
      {runs.length === 0 ? (
        <div className="empty">
          <p style={{ marginTop: 0 }}>No runs yet. Process a recording with the worker and it appears here:</p>
          <pre>worklens run samples/synthetic-invoice.mp4</pre>
          <p style={{ marginBottom: 0 }}>Reading from <code>{runsDir()}</code>. Set <code>WORKLENS_RUNS_DIR</code> to change it.</p>
        </div>
      ) : (
        <ul className="runlist">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/runs/${r.id}`}>
                <span><b>{r.source}</b> <span className="id">{r.id}</span></span>
                <span>{fmtSeconds(r.duration)}</span>
                <span>{r.findings} finding{r.findings === 1 ? "" : "s"}</span>
                <span style={{ color: "var(--ink-3)" }}>{r.sample ? "replay sample" : r.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <footer className="foot"><span>WorkLens · PurpleAI Labs · Meta Global AI Developer Hackathon 2026</span></footer>
    </main>
  );
}
