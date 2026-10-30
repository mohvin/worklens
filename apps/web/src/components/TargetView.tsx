"use client";

import type { Recommendations, Target, Disposition } from "@/lib/types";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import type { MapModel } from "@/lib/model";
import { nodeKey } from "@/lib/model";
import ProcessMap from "./ProcessMap";

// The target process: the same swimlane with the applied recommendations,
// a before/after timeline on one scale and the headline numbers.

export interface NodeTarget { disposition: Disposition; before: number; after: number; ids: string[] }
const RANK: Record<Disposition, number> = { keep: 0, assist: 1, automate: 2, remove: 3 };

/** Per-node view of the target's per-step dispositions (a node can hold several steps). */
export function nodeTargets(target: Target, model: MapModel): Map<string, NodeTarget> {
  const m = new Map<string, NodeTarget>();
  for (const s of target.steps) {
    const node = model.nodes.find((n) => n.rec === s.ref.rec && n.steps.includes(s.ref.step));
    if (!node) continue;
    const cur = m.get(node.key) ?? { disposition: "keep" as Disposition, before: 0, after: 0, ids: [] };
    cur.before += s.seconds_before; cur.after += s.seconds_after;
    if (RANK[s.disposition] > RANK[cur.disposition]) cur.disposition = s.disposition;
    for (const id of s.recommendation_ids) if (!cur.ids.includes(id)) cur.ids.push(id);
    m.set(node.key, cur);
  }
  // a node whose steps are all gone is removed/automated as a whole; partly gone keeps the strongest disposition
  for (const t of m.values()) if (t.after <= 0.05 && t.disposition === "assist") t.disposition = "automate";
  return m;
}

export function TargetHeadline({ target, applied, onApplied }: { target: Target; applied: "proposed" | "accepted"; onApplied: (a: "proposed" | "accepted") => void }) {
  const saved = target.seconds_before - target.seconds_after;
  const removed = target.steps.filter((s) => s.disposition === "remove").length, auto = target.steps.filter((s) => s.disposition === "automate").length, assist = target.steps.filter((s) => s.disposition === "assist").length;
  return (
    <section className="kpis" aria-label="Target process summary">
      <div className="kpi"><div className="l">Handling time</div><div className="v">{fmtClock(target.seconds_before)} <span className="arrow">→</span> <span className="good">{fmtClock(target.seconds_after)}</span></div><div className="c">−{fmtSeconds(saved)} · −{fmtPct(target.seconds_before ? saved / target.seconds_before : 0)} per run · estimate</div></div>
      <div className="kpi"><div className="l">Steps</div><div className="v">{target.steps_before} <span className="arrow">→</span> {target.steps_after}</div><div className="c">{removed} removed · {auto} automated · {assist} assisted</div></div>
      <div className="kpi"><div className="l">App switches</div><div className="v">{target.app_switches_before} <span className="arrow">→</span> {target.app_switches_after}</div><div className="c">between consecutive steps that remain</div></div>
      <div className="kpi"><div className="l">Handoffs</div><div className="v">{target.handoffs_before} <span className="arrow">→</span> {target.handoffs_after}</div><div className="c">{target.handoffs_before === 0 ? "single role" : target.handoff_in_app ? "by email → inside the system of record" : "unchanged"}</div></div>
      <div className="kpi"><div className="l">Applied</div><div className="v" style={{ display: "flex", gap: 4, marginTop: 4 }}><button className={`btn sm${applied === "proposed" ? " on" : ""}`} style={{ whiteSpace: "nowrap" }} onClick={() => onApplied("proposed")}>Proposed</button><button className={`btn sm${applied === "accepted" ? " on" : ""}`} style={{ whiteSpace: "nowrap" }} onClick={() => onApplied("accepted")}>Accepted</button></div><div className="c">{target.human_decisions_kept} human decision{target.human_decisions_kept === 1 ? "" : "s"} kept</div></div>
    </section>
  );
}

export function BeforeAfter({ target, model, colors }: { target: Target; model: MapModel; colors: Map<string, string> }) {
  const W = 1000, H = 26, LX = 56, BW = W - LX;
  const total = target.seconds_before || 1;
  const x = (t: number) => LX + (t / total) * BW;
  const rows = (after: boolean) => {
    let t = 0; const out: React.ReactNode[] = []; let lastRec = 0;
    for (const s of target.steps) {
      const d = after ? s.seconds_after : s.seconds_before;
      if (s.ref.rec !== lastRec) { out.push(<line key={`h${s.ref.rec}`} x1={x(t)} x2={x(t)} y1={-2} y2={H + 2} stroke="var(--brand)" strokeWidth={2} />); lastRec = s.ref.rec; }
      if (d <= 0) continue;
      const wait = /\b(wait|waiting|loading|load)\b/i.test(s.action);
      const fill = after && (s.disposition === "assist" || s.disposition === "automate") ? "var(--app-4)" : colors.get(s.application);
      out.push(<g key={`${s.ref.rec}:${s.ref.step}`}><title>{`${stepTitle(model, s.ref)} ${s.application}: ${s.action} (${fmtSeconds(d)})`}</title><rect x={x(t)} y={0} width={Math.max(1, (d / total) * BW)} height={H} rx={2} fill={fill} /><rect x={x(t)} y={0} width={Math.max(1, (d / total) * BW)} height={H} rx={2} fill="none" stroke="var(--surface)" strokeWidth={1.5} />{wait && <rect x={x(t)} y={0} width={Math.max(1, (d / total) * BW)} height={H} rx={2} fill="url(#wait)" />}</g>);
      t += d;
    }
    if (after && t < total) out.push(<rect key="gone" x={x(t)} y={0} width={(total - t) / total * BW} height={H} rx={2} fill="url(#gone)" />);
    return out;
  };
  return (
    <div className="tl ba">
      <svg viewBox={`-4 -4 ${W + 8} ${H * 2 + 20}`} role="img" aria-label="Handling time before and after">
        <defs>
          <pattern id="wait" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="6" fill="rgba(255,255,255,0.7)" /></pattern>
          <pattern id="gone" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8" fill="var(--border-2)" /></pattern>
        </defs>
        <g><text className="rolelabel" x={0} y={H / 2 + 4}>Today</text>{rows(false)}<text className="balabel" x={W} y={H / 2 + 4} textAnchor="end">{fmtClock(target.seconds_before)}</text></g>
        <g transform={`translate(0,${H + 12})`}><text className="rolelabel" x={0} y={H / 2 + 4}>Target</text>{rows(true)}<text className="balabel good" x={W} y={H / 2 + 4} textAnchor="end">{fmtClock(target.seconds_after)}</text></g>
      </svg>
    </div>
  );
}

const stepTitle = (model: MapModel, r: { rec: number; step: number }) => (model.recs.length === 1 ? `step ${r.step}` : `${(model.recs[r.rec]?.role ?? "R").split(/\s+/).map((w) => w[0]).join("").toUpperCase()}${r.step}`);

export function TargetMap({ recs, target, model, colors, selectedKey, zoom, onSelect }: { recs: Recommendations; target: Target; model: MapModel; colors: Map<string, string>; selectedKey: string | null; zoom: "fit" | 1; onSelect: (k: string | null) => void }) {
  const nt = nodeTargets(target, model);
  return <ProcessMap model={model} colors={colors} selectedKey={selectedKey} hotKeys={new Set()} zoom={zoom} onSelect={onSelect} target={nt} />;
}

export function WhatChanges({ recs, target, model, onSelect }: { recs: Recommendations; target: Target; model: MapModel; onSelect: (id: string) => void }) {
  const include = target.applied === "proposed" ? new Set(["proposed", "accepted", "done"]) : new Set(["accepted", "done"]);
  const items = recs.items.filter((i) => include.has(i.status)).sort((a, b) => b.seconds_saved - a.seconds_saved || b.potential_seconds - a.potential_seconds);
  const ids = new Set(target.steps.flatMap((s) => s.recommendation_ids));
  return (
    <div className="wc">
      <div className="card-h"><h2>What changes, in order of value</h2></div>
      {items.length === 0 && <div className="empty">Nothing applied yet. Accept recommendations, or switch to “All proposed”.</div>}
      <ul className="flist">
        {items.map((i) => (
          <li key={i.id} className="frow"><button onClick={() => onSelect(i.id)}>
            <span className="rank">{i.path === "fix" ? "F" : "AI"}</span>
            <span><div className="ftitle">{i.title}</div><div className="fmeta"><span>{i.refs.map((r) => stepTitle(model, r)).slice(0, 5).join(", ")}{i.refs.length > 5 ? "…" : ""}</span>{!ids.has(i.id) && i.seconds_saved === 0 && <span>{i.kind === "keep_human" ? "kept on purpose" : "no counted saving"}</span>}</div></span>
            <span className="ftime">{i.seconds_saved > 0 ? `−${fmtSeconds(i.seconds_saved)}` : "0 s"}</span>
          </button></li>
        ))}
      </ul>
      <div className="rfoot">Savings use the durations measured in {model.recs.length === 1 ? "this recording" : "these recordings"}; overlapping items are counted once, highest value first. Waits are kept unless a fix has evidence. {model.recs.length < 3 ? "A small sample: repeat on a few more recordings before quoting the numbers outside the team." : ""}</div>
    </div>
  );
}
