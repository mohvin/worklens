"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Pending } from "@/lib/runs";

const STAGES: [string, string][] = [
  ["uploaded", "Uploaded"],
  ["queued", "Queued for the worker"],
  ["sampling", "Sampling frames (ffmpeg, 1 fps, de-dupe)"],
  ["detecting", "Finding step boundaries; SAM 3.1 isolates what changed"],
  ["labelling", "Muse Spark names each step"],
  ["building", "Building the process map and findings"],
  ["built", "Done"],
];

export default function RunProgress({ id, initial }: { id: string; initial: Pending }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  useEffect(() => {
    if (p.status === "built" || p.status === "failed") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/runs/${id}/status`, { cache: "no-store" }); if (!r.ok) return;
      const j = (await r.json()) as { status: string; progress: Record<string, unknown>; error: string | null };
      setP((prev) => ({ ...prev, status: j.status, progress: j.progress, error: j.error }));
      if (j.status === "built") { clearInterval(t); router.refresh(); }
      if (j.status === "failed") clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [id, p.status, router]);

  const idx = STAGES.findIndex(([k]) => k === p.status);
  const log = (p.progress.log as string[] | undefined) ?? [];
  const failed = p.status === "failed";
  const label = STAGES.find(([k]) => k === p.status)?.[1] ?? p.status;
  return (
    <main className="page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Runs</Link><span>›</span><span>{p.source_name}</span></nav>
      <div className="pagehead">
        <div>
          <h1>{p.source_name}<span className={`chip ${failed ? "fail" : "proc"}`}>{failed ? "Failed" : `Processing · ${p.status}`}</span></h1>
          <div className="meta">Run {id} · uploaded {new Date(p.created_at).toLocaleString()}</div>
        </div>
      </div>
      {failed && (
        <div className="banner danger" role="alert">
          <div><b>Processing failed.</b> {p.error ?? "Unknown error."} The upload is kept; re-run from the home page by dropping the file again.</div>
        </div>
      )}
      <section className="card" aria-label="Processing">
        <div className="card-h"><h2>{failed ? "Stages" : "Processing"}</h2><span className="hint">{failed ? "" : `${label} · this page updates every 2 seconds`}</span></div>
        {STAGES.slice(0, 6).map(([k, l], i) => (
          <div key={k} className={`stage ${i < idx ? "done" : i === idx ? (failed ? "fail" : "now") : ""}`}><i />{l}</div>
        ))}
        {log.length > 0 && <pre className="log">{log.join("\n")}</pre>}
      </section>
    </main>
  );
}
