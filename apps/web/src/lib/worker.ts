import "server-only";

/** Call the hosted worker's enqueue endpoint with a body; returns its JSON or throws. */
export async function callWorker(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.WORKLENS_WORKER_URL;
  const secret = process.env.WORKLENS_WORKER_SECRET;
  if (!url || !secret) throw new Error("Worker is not configured on this deployment.");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, secret }) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j.error) throw new Error(String(j.error ?? `worker returned ${r.status}`));
  return j;
}
