"use client";

import { useState } from "react";
import type { Recommendation, Recommendations, RecStatus } from "@/lib/types";
import { fmtClock, fmtSeconds, fmtPct, kindLabel, mechanismLabel } from "@/lib/types";
import { frameUrl } from "@/lib/view";
import type { MapModel } from "@/lib/model";
import type { UFinding } from "@/lib/findings";

// Path 1 (fix the process) and path 2 (apply AI) as one reviewable list, with a
// detail panel that shows the evidence, the arithmetic and the decision controls.

export type Filter = "all" | "proposed" | "accepted" | "rejected";

export function stepLabel(model: MapModel, r: { rec: number; step: number }): string {
  if (model.recs.length === 1) return `step ${r.step}`;
  const role = model.recs[r.rec]?.role ?? `R${r.rec + 1}`;
  return `${role.split(/\s+/).map((w) => w[0]).join("").toUpperCase()}${r.step}`;
}

const conf = (c: Recommendation["confidence"]) => ({ high: "var(--success)", medium: "var(--warning)", low: "var(--text-3)" }[c]);

export function RecList({ recs, model, filter, onFilter, selectedId, onSelect }: { recs: Recommendations; model: MapModel; filter: Filter; onFilter: (f: Filter) => void; selectedId: string | null; onSelect: (id: string) => void }) {
  const show = recs.items.filter((i) => filter === "all" || i.status === filter);
  const fix = show.filter((i) => i.path === "fix"), ai = show.filter((i) => i.path === "ai");
  const s = recs.summary;
  const row = (i: Recommendation, n: number) => (
    <li key={i.id} className={`rrow${i.id === selectedId ? " sel" : ""}${i.status === "rejected" ? " off" : ""}`}>
      <button onClick={() => onSelect(i.id)} aria-pressed={i.id === selectedId}>
        <span className="rank">{n}</span>
        <span className="rmain">
          <span className="rtitle">{i.title}</span>
          <span className="rmeta">
            {i.path === "ai" && <span className={`rtag ${i.kind}`}>{kindLabel[i.kind]}</span>}
            {i.mechanism && <span className="rtag">{mechanismLabel[i.mechanism]}</span>}
            {i.finding_keys.length > 0 && <span>resolves a finding</span>}
            <span>{i.refs.length > 6 ? `${stepLabel(model, i.refs[0])}–${stepLabel(model, i.refs[i.refs.length - 1])}` : i.refs.map((r) => stepLabel(model, r)).join(", ")}</span>
            <span style={{ color: conf(i.confidence), fontWeight: 500 }}>{i.confidence} confidence</span>
            {i.status !== "proposed" && <span className={`rstatus ${i.status}`}>{i.status}</span>}
          </span>
        </span>
        <span className="rtime">{i.seconds_saved > 0.05 ? `−${fmtSeconds(i.seconds_saved)}` : i.potential_seconds > 0 ? `0–${fmtSeconds(i.potential_seconds)}` : "0 s"}<div>{i.seconds_saved > 0.05 ? fmtPct(i.share_saved) : i.potential_seconds > 0 ? "not counted" : i.kind === "keep_human" ? "kept" : i.status === "rejected" ? "rejected" : i.seconds_raw > 0 ? "covered by items above" : ""}</div></span>
      </button>
    </li>
  );
  let n = 0;
  return (
    <div className="recs">
      <div className="rfilter">
        <span>Show</span>
        {(["all", "proposed", "accepted", "rejected"] as Filter[]).map((f) => <button key={f} className={`chip${filter === f ? " on" : ""}`} onClick={() => onFilter(f)}>{f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}</button>)}
        <span className="hint">{s.proposed} proposed · {s.accepted} accepted · {s.rejected} rejected</span>
      </div>
      <div className="section-h" style={{ margin: "10px 12px 2px" }}>Fix the process <span>changes to how the work is done · −{fmtSeconds(s.fix_seconds)}</span></div>
      {fix.length ? <ul className="rlist">{fix.map((i) => row(i, ++n))}</ul> : <div className="empty" style={{ padding: "10px 12px", textAlign: "left" }}>Nothing to fix from the rules{filter !== "all" ? " with this filter" : ""}.</div>}
      <div className="section-h" style={{ margin: "14px 12px 2px" }}>Apply AI <span>where a model can do or prepare the step · −{fmtSeconds(s.ai_seconds)}{recs.model ? ` · classified by ${recs.model}` : ""}</span></div>
      {ai.length ? <ul className="rlist">{ai.map((i) => row(i, ++n))}</ul> : <div className="empty" style={{ padding: "10px 12px", textAlign: "left" }}>{s.ai_unavailable ? `AI path unavailable: ${s.ai_unavailable}.` : "No AI items with this filter."}</div>}
      <div className="rfoot">Savings are estimates from the measured durations in {model.recs.length === 1 ? "this recording" : "these recordings"}. Items on the same step are counted once, highest value first. Factors: {Object.entries(recs.factors).filter(([k]) => !["remove_step", "merge_steps", "reorder", "in_app_approval"].includes(k)).map(([k, v]) => `${mechanismLabel[k as keyof typeof mechanismLabel] ?? k} ×${v}`).join(" · ")}.</div>
    </div>
  );
}

export function RecDetail({ item, recs, model, findings, canDecide, onDecide, busy }: { item: Recommendation | null; recs: Recommendations; model: MapModel; findings: UFinding[]; canDecide: boolean; onDecide: (id: string, status: RecStatus, by: string, note: string) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  if (!item) return <div className="empty">Select a recommendation to see the evidence, how the saving was computed, what stays human and to record a decision.</div>;
  const resolved = item.finding_keys.map((k) => findings.find((f) => f.key === k)).filter(Boolean) as UFinding[];
  const values = [...new Set(item.refs.flatMap((r) => model.recs[r.rec]?.run.steps[r.step]?.label?.data_fields ?? []))].slice(0, 8);
  const decide = (status: RecStatus) => onDecide(item.id, status, name.trim(), note.trim());
  return (
    <div className="rdet">
      <div className="rd-sec">
        <div className="rmeta" style={{ marginBottom: 6 }}>{item.path === "ai" ? <span className={`rtag ${item.kind}`}>{kindLabel[item.kind]}</span> : <span className="rtag">Fix</span>}{item.mechanism && <span className="rtag">{mechanismLabel[item.mechanism]}</span>}<span>{item.source === "model" ? `classified by ${item.model}` : "from the rules"}</span></div>
        <h3>{item.title}</h3>
        <p>{item.detail}</p>
      </div>
      <div className="rd-sec">
        <h4>Saving and method</h4>
        <div className="rd-big">{item.seconds_saved > 0.05 ? `−${fmtSeconds(item.seconds_saved)}` : item.potential_seconds > 0 ? `0–${fmtSeconds(item.potential_seconds)}` : "0 s"}<small>{item.seconds_saved > 0.05 ? ` · ${fmtPct(item.share_saved)} of ${fmtClock(recs.summary.total_seconds)} · estimate` : item.potential_seconds > 0 ? " · potential, not counted" : item.kind === "keep_human" ? " · kept on purpose" : item.status === "rejected" ? " · rejected" : item.seconds_raw > 0 ? ` · the ${fmtSeconds(item.seconds_raw)} on these steps is already counted by higher-value items` : ""}</small></div>
        <code className="rd-method">{item.method}</code>
        <p>Confidence <b style={{ color: conf(item.confidence), fontWeight: 500 }}>{item.confidence}</b>. {item.rationale}</p>
      </div>
      {(item.evidence.length > 0 || values.length > 0) && (
        <div className="rd-sec">
          <h4>Evidence</h4>
          {item.evidence.length > 0 && (
            <div className="thumbs">
              {item.evidence.slice(0, 3).map((e, k) => { const rec = model.recs[e.rec]; if (!rec) return null; const t = rec.run.frames[Math.min(e.frame, rec.run.frames.length - 1)]?.t ?? 0; return <figure key={k}><img src={frameUrl(rec.run, rec.src, e.frame)} alt={`Evidence frame ${e.frame}`} loading="lazy" /><figcaption>{model.recs.length > 1 ? `${(rec.role ?? "").slice(0, 8)} ` : ""}{fmtClock(t)}</figcaption></figure>; })}
            </div>
          )}
          {values.length > 0 && <div className="chips">{values.map((v) => <span key={v}>{v}</span>)}</div>}
          {resolved.length > 0 && <div className="rd-findings">{resolved.map((f) => <span key={f.key}>Resolves <b>{f.title}</b> ({fmtSeconds(f.seconds)})</span>)}</div>}
        </div>
      )}
      <dl className="kv rd-sec">
        {item.stays_human && <><dt>Stays human</dt><dd>{item.stays_human}</dd></>}
        {item.guardrail && <><dt>Guardrail</dt><dd>{item.guardrail}</dd></>}
        {item.data_needed.length > 0 && <><dt>Data needed</dt><dd>{item.data_needed.join("; ")}</dd></>}
        {item.depends_on.length > 0 && <><dt>Depends on</dt><dd>{item.depends_on.join("; ")}</dd></>}
        {item.factor !== null && <><dt>Factor</dt><dd>×{item.factor} of the steps&apos; time ({mechanismLabel[item.mechanism!]})</dd></>}
      </dl>
      <div className="rd-sec">
        <div className="rowacts">
          <button className={`btn sm${item.status === "accepted" ? " on" : ""}`} disabled={!canDecide || busy} onClick={() => decide("accepted")}>Accept</button>
          <button className={`btn sm${item.status === "rejected" ? " on" : ""}`} disabled={!canDecide || busy} onClick={() => decide("rejected")}>Reject</button>
          <button className={`btn sm${item.status === "done" ? " on" : ""}`} disabled={!canDecide || busy} onClick={() => decide("done")}>Done</button>
          {item.status !== "proposed" && <button className="btn sm" disabled={!canDecide || busy} onClick={() => decide("proposed")}>Reset</button>}
          {busy && <span className="hint" style={{ alignSelf: "center" }}>Saving…</span>}
        </div>
        {canDecide ? (
          <div className="rd-form">
            <label><span>Your name</span><input id="rd-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="recorded with the decision" /></label>
            <label><span>Note (optional)</span><input id="rd-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. check the OCR module cost" /></label>
          </div>
        ) : <p className="hint">Decisions are recorded on hosted runs; this is the replay sample.</p>}
        <p className="prov-line">Status <b>{item.status}</b>{item.decided_by ? ` by ${item.decided_by}` : ""}{item.decided_at ? ` on ${new Date(item.decided_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}{item.note ? ` · “${item.note}”` : ""}. Generated {new Date(recs.generated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}{recs.model ? ` by ${recs.model} (prompt ${recs.prompt_version})` : ""}, savings by rules {recs.rules_version}.</p>
      </div>
    </div>
  );
}
