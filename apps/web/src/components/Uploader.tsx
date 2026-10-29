"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "creating" | "uploading" | "starting" | "error";
interface ProcOption { id: string; name: string; status: string }

export default function Uploader({ enabled, processes: initial = [] }: { enabled: boolean; processes?: ProcOption[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [role, setRole] = useState("");
  const [procs, setProcs] = useState<ProcOption[]>(initial);
  const [procChoice, setProcChoice] = useState<string>("");   // "" standalone, "new", or a process id
  const [newName, setNewName] = useState("");
  useEffect(() => { setProcs(initial); }, [initial]);

  async function send(file: File) {
    setError(null);
    setPhase("creating");
    try {
      let process_id: string | undefined;
      if (procChoice === "new") {
        if (!newName.trim()) throw new Error("Give the new process a name first.");
        const pr = await fetch("/api/processes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim() }) });
        const pj = (await pr.json()) as { id?: string; name?: string; error?: string };
        if (!pr.ok || !pj.id) throw new Error(pj.error ?? "Could not create the process.");
        process_id = pj.id;
        setProcs((p) => [{ id: pj.id!, name: pj.name ?? newName, status: "created" }, ...p]);
        setProcChoice(pj.id);
      } else if (procChoice) process_id = procChoice;
      if (process_id && !role.trim()) throw new Error("Say who recorded this (the role), so the handoff between roles can be named.");
      const create = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, size: file.size, type: file.type, process_id, role: role.trim() || undefined }) });
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
    <div className="upwrap">
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
    <div className="uform" aria-label="Who and which process">
      <label><span>Who recorded this</span><input id="up-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. AP clerk, Approver" disabled={busy} /></label>
      <label><span>Part of a process</span>
        <select id="up-process" value={procChoice} onChange={(e) => setProcChoice(e.target.value)} disabled={busy}>
          <option value="">Standalone recording</option>
          {procs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="new">New process…</option>
        </select>
      </label>
      {procChoice === "new" && <label><span>Process name</span><input id="up-newname" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Invoice approval" disabled={busy} /></label>}
      <p className="hint">A process is several recordings, one per role, in handoff order. Upload the first role, then the next one into the same process; the map merges once all are built.</p>
    </div>
    </div>
  );
}
