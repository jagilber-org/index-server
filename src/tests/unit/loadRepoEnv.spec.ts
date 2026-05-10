import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, 'scripts', 'Load-RepoEnv.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).status === 0;

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPwshJson<T>(command: string): T {
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout.trim()) as T;
}

describe.skipIf(!hasPwsh)('Load-RepoEnv.ps1', () => {
  it('loads valid .env entries and preserves existing process values by default', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-repoenv-'));
    try {
      const envPath = path.join(fixtureDir, '.env');
      fs.writeFileSync(
        envPath,
        [
          '# comment',
          '',
          'LRE_PLAIN= value with spaces ',
          'LRE_QUOTED="quoted value"',
          'LRE_EXIST=file',
          '1LRE_BAD=ignored',
        ].join('\n'),
        'utf8',
      );

      const output = runPwshJson<{
        plain: string;
        quoted: string;
        existing: string;
        invalid: string | null;
      }>(`
        $ErrorActionPreference = 'Stop'
        $env:LRE_EXIST = 'shell'
        . ${psQuote(scriptPath)} -Path ${psQuote(envPath)}
        [pscustomobject]@{
          plain = $env:LRE_PLAIN
          quoted = $env:LRE_QUOTED
          existing = $env:LRE_EXIST
          invalid = [Environment]::GetEnvironmentVariable('1LRE_BAD', 'Process')
        } | ConvertTo-Json -Compress
      `);

      expect(output).toEqual({
        plain: 'value with spaces',
        quoted: 'quoted value',
        existing: 'shell',
        invalid: null,
      });
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('overwrites existing process values when -Override is supplied', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-repoenv-'));
    try {
      const envPath = path.join(fixtureDir, '.env');
      fs.writeFileSync(envPath, 'LRE_EXIST=file\n', 'utf8');

      const output = runPwshJson<{ existing: string }>(`
        $ErrorActionPreference = 'Stop'
        $env:LRE_EXIST = 'shell'
        . ${psQuote(scriptPath)} -Path ${psQuote(envPath)} -Override
        [pscustomobject]@{
          existing = $env:LRE_EXIST
        } | ConvertTo-Json -Compress
      `);

      expect(output).toEqual({ existing: 'file' });
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
