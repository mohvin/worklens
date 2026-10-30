"use client";

import { useEffect, useRef, useState } from "react";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import { wrapText, frameUrl } from "@/lib/view";
import type { MapModel, MapNode } from "@/lib/model";

// Vertical swimlanes: one column per application, one row per screen in the
// order first seen, a band per role when the model holds several recordings.
// A jump between columns is an app switch; a dashed red arrow back up is a
// loop; a dashed purple arrow through a band is a handoff between roles.

const TRK = 46, HEAD = 46, GAP = 16, PADB = 24, BAND = 34, TW = 62, TH = 35;

export interface NodeTargetView { disposition: "keep" | "automate" | "assist" | "remove"; before: number; after: number; ids: string[] }
interface Props { model: MapModel; colors: Map<string, string>; selectedKey: string | null; hotKeys: Set<string>; zoom: "fit" | 1; onSelect: (key: string | null) => void; target?: Map<string, NodeTargetView> }

interface Pos { x: number; y: number; w: number; h: number; cx: number; my: number }

export default function ProcessMap({ model, colors, selectedKey, hotKeys, zoom, onSelect, target }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1000);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(Math.max(360, e.contentRect.width - 2)));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const { nodes, lanes, recs } = model;
  if (nodes.length === 0) return <div className="map" ref={ref}><div className="empty">No steps yet.</div></div>;

  const L = lanes.length;
  const LW = Math.max(176, Math.min(220, Math.floor((avail - TRK - 16) / L)));
  const NW = LW - 22;
  const nh = (d: number) => 50 + Math.round(40 * Math.min(1, d / 30));

  // rows
  const pos = new Map<string, Pos>();
  const bands: { y: number; rec: number }[] = [];
  let y = HEAD + 14;
  nodes.forEach((n, i) => {
    if ((i === 0 && n.role) || (i > 0 && n.rec !== nodes[i - 1].rec)) { bands.push({ y, rec: n.rec }); y += BAND + GAP; }
    const h = nh(n.dur); const x = TRK + n.lane * LW + 11;
    pos.set(n.key, { x, y, w: NW, h, cx: x + NW / 2, my: y + h / 2 });
    y += h + GAP;
  });
  const H = y + PADB, W = TRK + L * LW + 16;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const first = pos.get(nodes[0].key)!, last = pos.get(nodes[nodes.length - 1].key)!;
  const sy = bands.length && bands[0].rec === 0 ? bands[0].y + BAND + 8 : HEAD + 6;

  // edges
  let trackL = 0, trackR = 0;
  const edges = model.edges.map((e, k) => {
    const s = byKey.get(e.s), t = byKey.get(e.t), ps = pos.get(e.s), pt = pos.get(e.t);
    if (!s || !t || !ps || !pt) return null;
    const back = t.order < s.order, adj = t.order === s.order + 1;
    const dim = hotKeys.size > 0 && !(hotKeys.has(e.s) && hotKeys.has(e.t)) && !(back && hotKeys.has(e.t));
    let d: string, lab: [number, number] | null = null, anchor: "start" | "end" = "start";
    if (adj) {
      const mid = ps.y + ps.h + (pt.y - ps.y - ps.h) / 2;
      d = s.lane === t.lane ? `M${ps.cx} ${ps.y + ps.h} V${pt.y}` : `M${ps.cx} ${ps.y + ps.h} V${mid} H${pt.cx} V${pt.y}`;
      if (e.kind === "hand") { const b = bands.find((b) => b.rec === t.rec); lab = [W - 28, (b ? b.y + BAND / 2 : mid) + 4]; anchor = "end"; }
    } else {
      const left = t.lane <= (L - 1) / 2;
      const k2 = left ? trackL++ : trackR++;
      const tx = left ? TRK - 14 - k2 * 9 : W - 16 + 8 + k2 * 9;
      const sx = left ? ps.x : ps.x + ps.w, txe = left ? pt.x : pt.x + pt.w;
      d = `M${sx} ${ps.my} H${tx} V${pt.my} H${txe}`;
      if (back) { lab = [tx + (left ? -4 : 4), (ps.my + pt.my) / 2 + 4]; anchor = left ? "end" : "start"; }
    }
    return { k, d, lab, anchor, back, dim, kind: e.kind, count: e.count, label: e.label };
  }).filter((e): e is NonNullable<typeof e> => e !== null);
  const extraL = trackL * 9, extraR = trackR ? trackR * 9 + 8 : 0;
  const vbW = W + extraL + extraR;
  const scale = zoom === "fit" ? Math.min(1, avail / vbW) : 1;

  const marker = (e: { back: boolean; kind: string }) => (e.back ? "url(#arb)" : e.kind === "hand" ? "url(#arh)" : "url(#ar)");

  return (
    <div className="map" ref={ref}>
      <svg viewBox={`${-extraL} 0 ${vbW} ${H}`} width={Math.round(vbW * scale)} height={Math.round(H * scale)} role="img" aria-label="Process map, one column per application">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="6" fill="var(--text-3)" fillOpacity={0.22} /></pattern>
          <pattern id="assist" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="5" height="10" fill="var(--brand)" fillOpacity={0.1} /></pattern>
          <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text-3)" /></marker>
          <marker id="arb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--danger)" /></marker>
          <marker id="arh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--brand)" /></marker>
          {nodes.map((n) => { const p = pos.get(n.key)!; return <clipPath id={`c-${n.key.replace(":", "-")}`} key={n.key}><rect x={p.x + 7} y={p.y + 7} width={TW} height={TH} rx={2} /></clipPath>; })}
        </defs>

        {lanes.map((app, i) => {
          const x = TRK + i * LW; const t = nodes.filter((n) => n.lane === i).reduce((a, n) => a + n.dur, 0);
          return (
            <g key={app}>
              <rect className={`lanebg${i % 2 ? " alt" : ""}`} x={x} y={HEAD} width={LW} height={H - HEAD} />
              <line className="lanesep" x1={x} x2={x} y1={0} y2={H} />
              <rect className="lanehead" x={x} y={0} width={LW} height={HEAD} />
              <line className="lanehead-line" x1={x} x2={x + LW} y1={HEAD} y2={HEAD} />
              <circle cx={x + 16} cy={18} r={4} fill={colors.get(app)} />
              <text className="lanename" x={x + 26} y={22}>{app.length > 22 ? app.slice(0, 21) + "…" : app}</text>
              <text className="lanestat" x={x + 26} y={37}>{fmtSeconds(t)} · {fmtPct(t / model.total)}</text>
            </g>
          );
        })}
        <line className="lanesep" x1={W - 16} x2={W - 16} y1={0} y2={H} />

        {bands.map((b) => {
          const rec = recs[b.rec]; const role = rec.role ?? `Recording ${b.rec + 1}`;
          return (
            <g key={b.rec}>
              <rect className="band" x={TRK} y={b.y} width={W - TRK - 16} height={BAND} />
              <line className="bandline" x1={TRK} x2={W - 16} y1={b.y} y2={b.y} />
              <text className="bandname" x={TRK + 12} y={b.y + 21}>{role.toUpperCase()}</text>
              <text className="bandmeta" x={TRK + 12 + role.length * 8.2 + 16} y={b.y + 21}>{rec.run.source} · {fmtClock(rec.run.duration)} · {rec.run.steps.length} steps</text>
            </g>
          );
        })}

        <circle className="ends" cx={first.cx} cy={sy} r={5} />
        <path className="edge" d={`M${first.cx} ${sy + 5} V${first.y}`} markerEnd="url(#ar)" />
        <path className="edge" d={`M${last.cx} ${last.y + last.h} V${H - 10}`} markerEnd="url(#ar)" />
        <circle className="ends" cx={last.cx} cy={H - 7} r={5} strokeWidth={3} />

        {edges.map((e) => (
          <g key={e.k}>
            <path className={`edge${e.back ? " back" : e.kind === "hand" ? " hand" : ""}${e.dim ? " dim" : ""}`} d={e.d} markerEnd={marker(e)} />
            {e.lab && e.back && <text className="edgelabel" x={e.lab[0]} y={e.lab[1]} textAnchor={e.anchor} transform={`rotate(-90 ${e.lab[0]} ${e.lab[1]})`}>loop ×{e.count}</text>}
            {e.lab && e.kind === "hand" && <text className="handlabel" x={e.lab[0]} y={e.lab[1]} textAnchor="end">⇣ handoff{e.label ? ` · ${e.label}` : ""}</text>}
          </g>
        ))}

        {nodes.map((n) => <NodeBox key={n.key} n={n} p={pos.get(n.key)!} model={model} selected={n.key === selectedKey} hot={hotKeys.has(n.key)} dim={hotKeys.size > 0 && !hotKeys.has(n.key)} onSelect={onSelect} target={target?.get(n.key)} />)}
      </svg>
    </div>
  );
}

function NodeBox({ n, p, model, selected, hot, dim, onSelect, target }: { n: MapNode; p: Pos; model: MapModel; selected: boolean; hot: boolean; dim: boolean; onSelect: (key: string | null) => void; target?: NodeTargetView }) {
  const rec = model.recs[n.rec];
  const lines = wrapText(n.action, 17, 2);
  const t = target && target.disposition !== "keep" ? target : undefined;
  const cls = ["node", selected ? "selected" : "", hot ? "hot" : "", dim ? "dim" : "", t ? `t-${t.disposition}` : "", t && t.after > 0.05 && t.disposition !== "assist" ? "partial" : ""].join(" ");
  const tagText = t ? (t.disposition === "remove" ? (t.after > 0.05 ? "Shorter" : "Removed") : t.disposition === "automate" ? "Automated" : "Assisted") : "";
  return (
    <g className={cls} tabIndex={0} role="button" aria-label={`${n.application}: ${n.action}, ${fmtSeconds(n.dur)}`}
      onClick={() => onSelect(selected ? null : n.key)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(n.key); } }}>
      <rect className="box" x={p.x} y={p.y} width={p.w} height={p.h} rx={5} />
      {n.wait && <rect className="wait" x={p.x} y={p.y} width={p.w} height={p.h} rx={5} />}
      <image href={frameUrl(rec.run, rec.src, n.frame)} x={p.x + 7} y={p.y + 7} width={TW} height={TH} preserveAspectRatio="xMidYMid slice" clipPath={`url(#c-${n.key.replace(":", "-")})`} />
      <rect className="thumbframe" x={p.x + 7} y={p.y + 7} width={TW} height={TH} rx={2} />
      {lines.map((l, k) => <text key={k} className="action" x={p.x + 77} y={p.y + 20 + k * 15}>{l}</text>)}
      {t && <rect className="tfill" x={p.x} y={p.y} width={p.w} height={p.h} rx={5} />}
      {t ? <text className="dur" x={p.x + p.w - 8} y={p.y + p.h - 8} textAnchor="end">{fmtSeconds(t.before)} → {fmtSeconds(t.after)}</text>
         : <text className="dur" x={p.x + p.w - 8} y={p.y + p.h - 8} textAnchor="end">{fmtSeconds(n.dur)}{n.wait ? " wait" : ""} · {fmtPct(n.share)}</text>}
      {t && <g transform={`translate(${p.x + 7},${p.y + 7})`}><rect className="ttag" x={0} y={0} width={TW} height={14} rx={2} /><text className="ttagtext" x={TW / 2} y={10.5} textAnchor="middle">{tagText}</text></g>}
      <text className="stepno" x={p.x + 7} y={p.y + p.h - 8}>step {n.steps.length > 1 ? n.steps.join(", ") : n.steps[0]}</text>
      {n.visits > 1 && <g transform={`translate(${p.x + p.w - 12},${p.y + 12})`}><circle r={9} fill="var(--danger)" /><text className="badge" textAnchor="middle" y={3.5}>{n.visits}×</text></g>}
    </g>
  );
}
