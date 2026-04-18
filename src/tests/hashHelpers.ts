/*
 * Governance / Hash test helpers
 * Lightweight utilities to extract index hash and poll for changes without
 * importing broader test harness code. We intentionally keep these any-typed
 * to avoid pulling additional declaration surfaces into the typed lint set.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = any;

// Extract index hash from a result object (create/list/get/update) shape.
// Falls back through several common fields for resilience.
export function extractindexHash(obj: unknown): string | undefined {
  if(!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  const direct = typeof o.hash === 'string' ? o.hash : undefined;
  if(direct) return direct;
  // Some shapes may nest under item or result.item
  const item = (o.item && typeof o.item === 'object') ? o.item as Record<string, unknown> : undefined;
  const nested = item && typeof item.hash === 'string' ? item.hash : undefined;
  return nested;
}

// Convenience: read -> index hash (with fallback after an optional delay)
export async function readindexHash(client: AnyClient, id: string): Promise<string | undefined> {
  try { const r = await client.read(id); return extractindexHash(r); } catch { return undefined; }
}

// Poll until index hash changes from oldHash (or until timeout). Returns new hash or undefined if unchanged.
export async function waitForindexHashChange(client: AnyClient, id: string, oldHash: string | undefined, timeoutMs = 1500, intervalMs = 50): Promise<string | undefined> {
  const start = Date.now();
  let latest: string | undefined;
  while(Date.now() - start < timeoutMs){
    latest = await readindexHash(client, id);
    if(latest && oldHash && latest !== oldHash) return latest;
    await new Promise(r=> setTimeout(r, intervalMs));
  }
  // One final attempt (in case change landed right at boundary)
  latest = await readindexHash(client, id);
  return (latest && oldHash && latest !== oldHash) ? latest : undefined;
}

// Create helper (body only, rely on lax defaults) capturing initial hash & id
export async function createInstruction(client: AnyClient, id: string, body: string){
  return client.create({ id, body });
}
