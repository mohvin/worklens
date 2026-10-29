"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "creating" | "uploading" | "starting" | "error";

export default function Uploader({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function send(file: File) {
    setError(null);
    setPhase("creating");
    try {
      const create = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, size: file.size, type: file.type }) });
      const j = (await create.json()) as { id?: string; uploadUrl?: string; contentType?: string; error?: string };
      if (!create.ok || !j.id || !j.uploadUrl) throw new Error(j.error ?? "Could not create the run.");
      setPhase("uploading");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", j.uploadUrl!);
        xhr.setRequestHeader("Content-Type", j.contentType ?? file.type);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
        xhr.onerror = () => reject(new Error("Upload failed: network error."));
        xhr.send(file);
      });
      setPhase("starting");
      const start = await fetch(`/api/runs/${j.id}/start`, { method: "POST" });
      const sj = (await start.json()) as { ok?: boolean; error?: string };
      if (!start.ok || !sj.ok) throw new Error(sj.error ?? "The worker did not accept the run.");
      router.push(`/runs/${j.id}`);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = phase === "creating" || phase === "uploading" || phase === "starting";
  if (!enabled) {
    return (
      <div className="drop disabled">
        <p>Uploads are off on this deployment. Process a recording locally with <code>worklens run recording.mp4</code>.</p>
      </div>
    );
  }
  return (
    <div
      className={`drop${over ? " over" : ""}${busy ? " busy" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !busy) send(f); }}
    >
      <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ""; }} />
      {busy ? (
        <>
          <div className="bar"><i style={{ width: `${phase === "uploading" ? pct : phase === "starting" ? 100 : 2}%` }} /></div>
          <p>{phase === "creating" ? "Creating the run…" : phase === "uploading" ? `Uploading ${pct}%` : "Starting the pipeline…"}</p>
        </>
      ) : (
        <>
          <p className="lead">Drop a screen recording here</p>
          <p>MP4, MOV or WebM, up to 500 MB. A 10-minute recording takes about 3 minutes to process.</p>
          <button className="btn primary pick" onClick={() => input.current?.click()}>Choose a file</button>
          {error && <p className="err">{error}</p>}
        </>
      )}
    </div>
  );
}
