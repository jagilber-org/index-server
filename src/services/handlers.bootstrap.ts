import { registerHandler } from '../server/registry';
import { requestBootstrapToken, finalizeBootstrapToken, getBootstrapStatus, mutationGatedReason } from './bootstrapGating';
import { getRuntimeConfig } from '../config/runtimeConfig';

/**
 * Issue #358: bootstrap-confirm responses must surface the runtime mutation
 * flag at the moment operators need it. Without this, an operator that has
 * confirmed bootstrap but left INDEX_SERVER_MUTATION=0 sees no signal that
 * writes will fail; mutation attempts then silently no-op (see
 * `instructions.add.ts` visibility-anomaly branch).
 *
 * Returns `{ mutationEnabled }` always, plus an actionable `mutationHint`
 * only when mutations are disabled.
 */
function mutationStatusFields(): { mutationEnabled: boolean; mutationHint?: string } {
  const enabled = getRuntimeConfig().mutation.enabled;
  if (enabled) return { mutationEnabled: true };
  return {
    mutationEnabled: false,
    mutationHint: 'INDEX_SERVER_MUTATION is disabled — mutation tools will return errors. Set INDEX_SERVER_MUTATION=1 (or leave it unset, which defaults to enabled) in the server environment, then restart the server.',
  };
}

registerHandler('bootstrap_request', (p:{ rationale?: string }) => {
  const reason = mutationGatedReason();
  return { status: getBootstrapStatus(), gatedReason: reason, ...requestBootstrapToken(p?.rationale), ...mutationStatusFields() };
});

registerHandler('bootstrap_confirmFinalize', (p:{ token:string }) => {
  if(!p || typeof p.token !== 'string' || !p.token.trim()) return { error:'missing_token', ...mutationStatusFields() };
  const result = finalizeBootstrapToken(p.token.trim());
  return { result, status: getBootstrapStatus(), ...mutationStatusFields() };
});

registerHandler('bootstrap_status', () => {
  return { status: getBootstrapStatus(), gatedReason: mutationGatedReason(), ...mutationStatusFields() };
});

// Unified bootstrap handler (002 Phase 2c)
registerHandler('bootstrap', (params: { action: string; [k: string]: unknown }) => {
  const { action, ...rest } = params || {} as { action: string };
  if (!action) throw new Error('Missing required parameter: action');

  if (action === 'status') {
    return { ...getBootstrapStatus(), ...mutationStatusFields() };
  }
  if (action === 'request') {
    const reason = mutationGatedReason();
    return { status: getBootstrapStatus(), gatedReason: reason, ...requestBootstrapToken((rest as { rationale?: string }).rationale), ...mutationStatusFields() };
  }
  if (action === 'confirm') {
    const token = (rest as { token?: string }).token;
    if (!token || typeof token !== 'string' || !token.trim()) return { error: 'missing_token', ...mutationStatusFields() };
    const result = finalizeBootstrapToken(token.trim());
    return { result, status: getBootstrapStatus(), ...mutationStatusFields() };
  }

  throw new Error(`Unknown bootstrap action: ${action}. Valid: request, confirm, status`);
});
