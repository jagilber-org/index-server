import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('pre-push public repo guard hardening', () => {
  it('uses execFileSync with argument arrays for gh visibility checks instead of shell-interpolated execSync', () => {
    const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'pre-push-public-guard.cjs');
    const src = fs.readFileSync(scriptPath, 'utf8');

    expect(src).toContain("const { execFileSync } = require('child_process');");
    expect(src).toContain("execFileSync('gh', ['api', `repos/${ownerRepo}`, '--jq', '.visibility']");
    expect(src).not.toContain('execSync(`gh api');
  });
});
