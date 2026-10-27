import { notFound } from "next/navigation";
import { getRun } from "@/lib/runs";
import RunView from "@/components/RunView";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  return <RunView run={run} />;
}
