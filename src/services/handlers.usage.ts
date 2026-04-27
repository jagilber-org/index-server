import { registerHandler } from '../server/registry';
import { ensureLoaded, incrementUsage, loadUsageSnapshot } from './indexContext';

registerHandler('usage_track', (p: { id: string; action?: string; signal?: string; comment?: string }) => {
  if (!p.id) return { error: 'missing id' };
  const opts = { action: p.action, signal: p.signal, comment: p.comment };
  const r = incrementUsage(p.id, opts);
  if (!r) return { notFound: true };
  return r;
});

registerHandler('usage_hotset', (p: { limit?: number }) => {
  const st = ensureLoaded();
  const snap = loadUsageSnapshot() as Record<string, { lastSignal?: string; lastComment?: string }>;
  const limit = Math.max(1, Math.min(p.limit ?? 10, 100));

  const items = [...st.list]
    .filter(e => (e.usageCount ?? 0) > 0)
    .sort((a, b) => {
      const ua = a.usageCount ?? 0;
      const ub = b.usageCount ?? 0;
      if (ub !== ua) return ub - ua;
      return (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '');
    })
    .slice(0, limit)
    .map(e => {
      const rec = snap[e.id] || {};
      const item: Record<string, unknown> = {
        id: e.id,
        usageCount: e.usageCount,
        lastUsedAt: e.lastUsedAt,
      };
      if (rec.lastSignal) item.lastSignal = rec.lastSignal;
      if (rec.lastComment) item.lastComment = rec.lastComment;
      return item;
    });

  return { hash: st.hash, count: items.length, items, limit };
});

export {};
