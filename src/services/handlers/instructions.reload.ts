import { registerHandler } from '../../server/registry';
import { ensureLoaded, invalidate } from '../indexContext';
import { logAudit } from '../auditLog';
import { guard } from './instructions.shared';

registerHandler('index_reload', guard('index_reload', () => {
  invalidate();
  const st = ensureLoaded();
  const resp = { reloaded: true, hash: st.hash, count: st.list.length };
  logAudit('reload', undefined, { count: st.list.length });
  return resp;
}));

export {};
