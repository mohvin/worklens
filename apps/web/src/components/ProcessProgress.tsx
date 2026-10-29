"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface ProcessStatus { status: string; error: string | null; recordings: { id: string; role: string | null; source: string; status: string; error: string | null }[] }

const LABEL: Record<string, string> = { uploaded: "uploaded", queued: "queued", sampling: "sampling frames", detecting: "finding steps", labelling: "labelling", building: "building map", built: "built", failed: "failed" };

export default function ProcessProgress({ id, name, initial }: { id: string; name: string; initial: ProcessStatus }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const allBuilt = p.recordings.length > 0 && p.recordings.every((r) => r.status === "built");
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch(`/api/processes/${id}/status`, { cache: "no-store" }); if (!r.ok) return;
      const j = (await r.json()) as ProcessStatus;
      setP(j);
      if (j.status === "built" && j.recordings.every((x) => x.status === "built")) { clearInterval(t); router.refresh(); }
    }, 3000);
    return () => clearInterval(t);
  }, [id, router]);
  async function merge() {
    setBusy(true);
    try { await fetch(`/api/processes/${id}/build`, { method: "POST" }); } finally { setBusy(false); }
  }
  const failed = p.status === "failed";
  return (
    <main className="page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Runs</Link><span>›</span><span>{name}</span></nav>
      <div className="pagehead">
        <div>
          <h1>{name}<span className={`chip ${failed ? "fail" : "proc"}`}>{failed ? "Merge failed" : p.recordings.length === 0 ? "Empty process" : allBuilt ? "Merging…" : "Waiting for recordings"}</span></h1>
          <div className="meta">Process {id} · {p.recordings.length} recording{p.recordings.length === 1 ? "" : "s"} · this page updates every 3 seconds</div>
        </div>
        <div className="actions">{allBuilt && <button className="btn" onClick={merge} disabled={busy}>{busy ? "Merging…" : "Merge again"}</button>}</div>
      </div>
      {failed && <div className="banner danger" role="alert"><div><b>The merge failed.</b> {p.error ?? "Unknown error."}</div></div>}
      <section className="card" aria-label="Recordings">
        <div className="card-h"><h2>Recordings</h2><span className="hint">one per role, in handoff order · the process map appears once every recording is built</span></div>
        {p.recordings.length === 0 && <div className="empty">No recordings yet. Upload one from the home page and pick this process in the form under the drop zone.</div>}
        {p.recordings.map((r, i) => (
          <div key={r.id} className={`stage ${r.status === "built" ? "done" : r.status === "failed" ? "fail" : "now"}`}>
            <i />
            <span style={{ minWidth: 120 }}><b style={{ color: "var(--text)" }}>{r.role || `Recording ${i + 1}`}</b></span>
            <Link href={`/runs/${r.id}`} style={{ color: "var(--text-2)" }}>{r.source}</Link>
            <span style={{ marginLeft: "auto" }}>{LABEL[r.status] ?? r.status}{r.error ? ` · ${r.error}` : ""}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
