import { notFound } from "next/navigation";
import { getRun } from "@/lib/runs";
import RunView from "@/components/RunView";
import RunProgress from "@/components/RunProgress";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await getRun(id);
  if (!loaded) notFound();
  if (!loaded.run) return <RunProgress id={id} initial={loaded.pending!} />;
  return <RunView run={loaded.run} frameBase={loaded.frameBase} frames={loaded.frames} sample={loaded.source === "sample"} processedAt={loaded.processedAt ?? null} />;
}
