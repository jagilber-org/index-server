import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT_PATH = resolve(__dirname, '..', '..', '..', 'scripts', 'hooks', 'pre-push-log-hygiene.ps1');
const src = readFileSync(SCRIPT_PATH, 'utf8');

describe('pre-push log hygiene run scoping', () => {
  it('uses the latest completed test sentinel start time for --since', () => {
    expect(src).toContain("'.test-run-complete.latest'");
    expect(src).toMatch(/\.started/);
    expect(src).toMatch(/FromUnixTimeMilliseconds/);
    expect(src).toMatch(/'--since'/);
  });
});
