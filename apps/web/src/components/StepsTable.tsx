"use client";

import type { Run } from "@/lib/types";
import { fmtClock, fmtSeconds } from "@/lib/types";
import { nodeOfStep } from "@/lib/view";

interface Props { run: Run; colors: Map<string, string>; selectedId: string | null; onSelect: (id: string | null) => void }

export default function StepsTable({ run, colors, selectedId, onSelect }: Props) {
  return (
    <table className="steps">
      <thead>
        <tr><th>#</th><th>Start</th><th>Length</th><th>Application</th><th>Action</th><th>Object</th><th>Fields seen</th></tr>
      </thead>
      <tbody>
        {run.steps.map((s) => {
          const node = nodeOfStep(run, s.index);
          const app = s.label?.application ?? "Unknown";
          return (
            <tr key={s.index} className={node && node.id === selectedId ? "selected" : undefined} onClick={() => onSelect(node?.id ?? null)}>
              <td className="num">{s.index}</td>
              <td className="num">{fmtClock(s.t_start)}</td>
              <td className="num">{fmtSeconds(s.duration)}</td>
              <td><span style={{ color: colors.get(app) }}>●</span> {app}</td>
              <td>{s.label ? s.label.action : <span className="err">unlabelled{s.label_error ? `: ${s.label_error}` : ""}</span>}{s.label && <span className="conf"> {s.label.confidence.toFixed(2)}</span>}</td>
              <td>{s.label?.object}</td>
              <td style={{ color: "var(--ink-2)" }}>{s.label?.data_fields.join(", ")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
