import { registerHandler } from '../server/registry';
import { requestBootstrapToken, finalizeBootstrapToken, getBootstrapStatus, mutationGatedReason } from './bootstrapGating';

registerHandler('bootstrap_request', (p:{ rationale?: string }) => {
  const reason = mutationGatedReason();
  return { status: getBootstrapStatus(), gatedReason: reason, ...requestBootstrapToken(p?.rationale) };
});

registerHandler('bootstrap_confirmFinalize', (p:{ token:string }) => {
  if(!p || typeof p.token !== 'string' || !p.token.trim()) return { error:'missing_token' };
  const result = finalizeBootstrapToken(p.token.trim());
  return { result, status: getBootstrapStatus() };
});

registerHandler('bootstrap_status', () => {
  return { status: getBootstrapStatus(), gatedReason: mutationGatedReason() };
});

// Unified bootstrap handler (002 Phase 2c)
registerHandler('bootstrap', (params: { action: string; [k: string]: unknown }) => {
  const { action, ...rest } = params || {} as { action: string };
  if (!action) throw new Error('Missing required parameter: action');

  if (action === 'status') {
    return getBootstrapStatus();
  }
  if (action === 'request') {
    const reason = mutationGatedReason();
    return { status: getBootstrapStatus(), gatedReason: reason, ...requestBootstrapToken((rest as { rationale?: string }).rationale) };
  }
  if (action === 'confirm') {
    const token = (rest as { token?: string }).token;
    if (!token || typeof token !== 'string' || !token.trim()) return { error: 'missing_token' };
    const result = finalizeBootstrapToken(token.trim());
    return { result, status: getBootstrapStatus() };
  }

  throw new Error(`Unknown bootstrap action: ${action}. Valid: request, confirm, status`);
});
