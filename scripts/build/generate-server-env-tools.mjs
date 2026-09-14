#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const registryPath = path.join(root, 'dist', 'services', 'toolRegistry.js');
const mappingPath = path.join(root, 'scripts', 'mappings', 'server-env-tools.json');

if (!fs.existsSync(registryPath)) {
  console.error('Build output not found. Run `npm run build` first.');
  process.exit(1);
}

// Pin all ambient gates so the generated artifact is environment-independent.
process.env.INDEX_SERVER_STRESS_DIAG = '1';
process.env.INDEX_SERVER_MESSAGING_ENABLED = '1';

const current = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
const { getToolRegistry } = await import(pathToFileURL(registryPath).href);
const toolNames = getToolRegistry({ tier: 'admin' }).map(entry => entry.name);
const generated = {
  repoRoot: current.repoRoot ?? '<repo-root>',
  envVars: current.envVars ?? [],
  toolNames,
};

fs.writeFileSync(mappingPath, `${JSON.stringify(generated, null, 2)}\n`);
console.error(`Wrote ${mappingPath} (${toolNames.length} tools)`);
