import { notFound } from "next/navigation";
import { getProcess } from "@/lib/runs";
import ProcessView from "@/components/ProcessView";
import ProcessProgress from "@/components/ProcessProgress";

export const dynamic = "force-dynamic";

export default async function ProcessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await getProcess(id);
  if (!loaded) notFound();
  const ready = loaded.proc && loaded.proc.recordings.every((r) => loaded.recs.find((x) => x.id === r.run_id)?.run);
  if (!ready || !loaded.proc) {
    return <ProcessProgress id={id} name={loaded.row.name} initial={{ status: loaded.row.status, error: loaded.row.error, recordings: loaded.recs.map((r) => ({ id: r.id, role: r.role, source: r.source, status: r.status, error: r.error })) }} />;
  }
  return <ProcessView proc={loaded.proc} recs={loaded.recs} recommendations={loaded.recommendations} processedAt={new Date(loaded.row.updated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} />;
}
