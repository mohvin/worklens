"use client";

import { useState } from "react";
import type { Recommendations, RecStatus } from "@/lib/types";
import type { MapModel } from "@/lib/model";
import type { UFinding } from "@/lib/findings";
import { RecList, RecDetail, type Filter } from "./Recommendations";
import { BeforeAfter, TargetHeadline, TargetMap, WhatChanges } from "./TargetView";

// Shared between the run page and the process page: the Recommendations and
// Target process tabs, their right-hand panels, and the decision round trip.

export type RecTab = "recs" | "target";

export function useRecommendations(initial: Recommendations | null, decideUrl: string | null) {
  const [recs, setRecs] = useState<Recommendations | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (id: string, status: RecStatus, by: string, note: string) => {
    if (!decideUrl) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(decideUrl, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id: id, status, decided_by: by, note }) });
      const j = (await r.json()) as { recommendations?: Recommendations; error?: string };
      if (!r.ok || !j.recommendations) throw new Error(j.error ?? "The decision was not saved.");
      setRecs(j.recommendations);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const regenerate = async () => {
    if (!decideUrl) return;
    setBusy(true); setError(null);
    try { const r = await fetch(decideUrl, { method: "POST" }); const j = (await r.json()) as { error?: string }; if (!r.ok) throw new Error(j.error ?? "Could not start"); setError("Regenerating in the background; reload in a minute."); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return { recs, busy, error, decide, regenerate };
}

export interface RecState {
  recs: Recommendations | null; model: MapModel; colors: Map<string, string>; findings: UFinding[];
  filter: Filter; setFilter: (f: Filter) => void; selectedId: string | null; setSelectedId: (id: string | null) => void;
  applied: "proposed" | "accepted"; setApplied: (a: "proposed" | "accepted") => void;
  zoom: "fit" | 1; selectedKey: string | null; onSelectNode: (k: string | null) => void;
  canDecide: boolean; busy: boolean; error: string | null; decide: (id: string, status: RecStatus, by: string, note: string) => void; regenerate: () => void;
}

export function RecEmpty({ canDecide, busy, regenerate, error }: { canDecide: boolean; busy: boolean; regenerate: () => void; error: string | null }) {
  return (
    <div className="empty" style={{ padding: 24 }}>
      <p style={{ margin: "0 0 10px" }}>No recommendations yet for this {canDecide ? "run" : "sample"}.</p>
      {canDecide ? <button className="btn" disabled={busy} onClick={regenerate}>Generate recommendations</button> : <p style={{ margin: 0 }}>Generate them with <code>worklens recommend</code> and bundle the result with the sample.</p>}
      {error && <p className="err" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}

export function RecMain({ tab, st }: { tab: RecTab; st: RecState }) {
  if (!st.recs) return <RecEmpty canDecide={st.canDecide} busy={st.busy} regenerate={st.regenerate} error={st.error} />;
  if (tab === "recs") return <RecList recs={st.recs} model={st.model} filter={st.filter} onFilter={st.setFilter} selectedId={st.selectedId} onSelect={st.setSelectedId} />;
  const target = st.applied === "accepted" ? st.recs.target_accepted : st.recs.target;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <TargetHeadline target={target} applied={st.applied} onApplied={st.setApplied} />
      <div className="card"><div className="card-h"><h2>Before and after</h2><span className="hint">same scale · striped tail is time removed · purple segments are AI-assisted</span></div><BeforeAfter target={target} model={st.model} colors={st.colors} /></div>
      <div className="card"><div className="card-h"><h2>Target process</h2><span className="hint">grey: removed or automated · hatched: assisted · durations before → after</span></div><TargetMap recs={st.recs} target={target} model={st.model} colors={st.colors} selectedKey={st.selectedKey} zoom={st.zoom} onSelect={st.onSelectNode} /></div>
    </div>
  );
}

export function RecSide({ tab, st }: { tab: RecTab; st: RecState }) {
  if (!st.recs) return <aside className="card inspector"><div className="empty">Recommendations appear here once generated.</div></aside>;
  if (tab === "recs") {
    const item = st.recs.items.find((i) => i.id === st.selectedId) ?? null;
    return (
      <aside className="card inspector" aria-label="Recommendation">
        <div className="tabs" role="tablist"><span className="tab" aria-selected>Recommendation</span>{st.error && <span className="hint" style={{ color: "var(--danger)", alignSelf: "center", marginLeft: "auto", paddingRight: 8, fontSize: ".8rem" }}>{st.error}</span>}</div>
        <div className="body"><RecDetail item={item} recs={st.recs} model={st.model} findings={st.findings} canDecide={st.canDecide} onDecide={st.decide} busy={st.busy} /></div>
      </aside>
    );
  }
  const target = st.applied === "accepted" ? st.recs.target_accepted : st.recs.target;
  return (
    <aside className="card inspector wc" aria-label="What changes">
      <div className="body"><WhatChanges recs={st.recs} target={target} model={st.model} onSelect={(id) => st.setSelectedId(id)} /></div>
    </aside>
  );
}
