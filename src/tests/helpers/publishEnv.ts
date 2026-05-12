const SENSITIVE_ENV_PREFIXES = [
  'AZURE_', 'ARM_', 'TF_VAR_', 'VITE_AZURE_', 'WEBVIEW_TEST_',
  'SUBSCRIPTION', 'TENANT', 'CLIENT', 'ADMIN_', 'SF_',
  'DEMO_', 'COST_', 'ADO_', 'AI_', 'USER_TENANT',
];

const SENSITIVE_ENV_EXACT = new Set([
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FIGMA_API_KEY', 'NPM_TOKEN',
  'CODECOV_TOKEN', 'GITHUB_APP_PRIVATE_KEY_FILE', 'GODADDY_API_KEY',
  'GODADDY_API_SECRET', 'KEY_VAULT_1', 'DEMO_KEY_VAULT_1',
]);

export function sanitizedPublishEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      SENSITIVE_ENV_EXACT.has(key) ||
      SENSITIVE_ENV_PREFIXES.some(prefix => key.startsWith(prefix)) ||
      /SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|SAS|_PAT$|SUBSCRIPTION|TENANT|CLIENT_ID/i.test(key)
    ) {
      continue;
    }
    env[key] = value;
  }
  return env;
}
