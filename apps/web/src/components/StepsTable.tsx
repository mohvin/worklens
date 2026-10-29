"use client";

import type { Run } from "@/lib/types";
import { fmtClock, fmtSeconds } from "@/lib/types";
import { nodeOfStep } from "@/lib/view";

interface Props { run: Run; colors: Map<string, string>; selectedId: string | null; onSelect: (id: string | null) => void }

export default function StepsTable({ run, colors, selectedId, onSelect }: Props) {
  return (
    <table className="table">
      <thead>
        <tr><th className="num">#</th><th className="num">Start</th><th className="num">Length</th><th>Application</th><th>Action · confidence</th><th className="hide-sm">Object</th><th className="hide-sm">Fields seen</th></tr>
      </thead>
      <tbody>
        {run.steps.map((s) => {
          const node = nodeOfStep(run, s.index); const app = s.label?.application ?? "Unknown";
          return (
            <tr key={s.index} className={node && node.id === selectedId ? "selected" : undefined} onClick={() => onSelect(node?.id ?? null)}>
              <td className="num">{s.index}</td>
              <td className="num">{fmtClock(s.t_start)}</td>
              <td className="num">{fmtSeconds(s.duration)}</td>
              <td><span className="dot" style={{ background: colors.get(app) }} />{app}</td>
              <td>{s.label ? <>{s.label.action} <span className="conf">{s.label.confidence.toFixed(2)}</span></> : <span className="err">unlabelled{s.label_error ? `: ${s.label_error}` : ""}</span>}</td>
              <td className="hide-sm">{s.label?.object}</td>
              <td className="hide-sm" style={{ color: "var(--text-2)" }}>{s.label?.data_fields.join(", ")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
