import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as { version: string };

function runPwsh(scriptPath: string, args: string[], cwd = repoRoot) {
  return execFileSync('pwsh', ['-NoProfile', '-File', scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listCleanRoomTempDirs(repoName: string): Set<string> {
  const prefix = `publish-${repoName}-`;
  if (!fs.existsSync(os.tmpdir())) return new Set();
  return new Set(
    fs.readdirSync(os.tmpdir())
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => path.join(os.tmpdir(), entry)),
  );
}

describe('release/publication entrypoint safety', () => {
  it('smoke-runs the root release workflow front door in dry-run mode', () => {
    const cleanRoomPath = path.join(os.tmpdir(), `index-server-release-smoke-${process.pid}`);
    const output = runPwsh(path.join(repoRoot, 'scripts', 'Invoke-ReleaseWorkflow.ps1'), [
      '-DryRun',
      '-Tag',
      `v${packageManifest.version}`,
      '-RemoteUrl',
      'https://github.com/jagilber-org/index-server.git',
      '-CleanRoomPath',
      cleanRoomPath,
    ]);

    expect(output).toContain('Dry run complete');
    expect(output).toContain('Public mirror delivery');
  });

  it('cleans the clean-room temp directory when forbidden artifact validation fails', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-room-fixture-'));
    const target = path.join(os.tmpdir(), `clean-room-target-${process.pid}`);
    try {
      fs.writeFileSync(path.join(fixture, 'package.json'), '{"name":"fixture"}\n', 'utf8');
      fs.writeFileSync(path.join(fixture, '.publish-exclude'), '\n', 'utf8');
      execFileSync('git', ['init', '--quiet'], { cwd: fixture });
      execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: fixture });
      execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: fixture });
      execFileSync('git', ['add', '.'], { cwd: fixture });
      execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: fixture });

      const before = listCleanRoomTempDirs(path.basename(fixture));
      expect(() => runPwsh(path.join(repoRoot, 'scripts', 'New-CleanRoomCopy.ps1'), [
        '-LocalPath',
        target,
        '-ForbiddenPaths',
        'package.json',
        '-Force',
      ], fixture)).toThrow();
      const after = listCleanRoomTempDirs(path.basename(fixture));

      const leaked = [...after].filter((entry) => !before.has(entry));
      expect(leaked).toEqual([]);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it('release workflow verifies exact local and remote ref SHAs after internal push', () => {
    const releaseScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'Invoke-ReleaseWorkflow.ps1'), 'utf8');

    expect(releaseScript).toContain('Get-LocalRefSha');
    expect(releaseScript).toContain('Get-RemoteRefSha');
    expect(releaseScript).toContain('matches local SHA');
    expect(releaseScript).toContain('expected local');
  });

  it('release preflight skips only the commit-branch guard when running all files', () => {
    const releaseScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'Invoke-ReleaseWorkflow.ps1'), 'utf8');

    expect(releaseScript).toContain('function Invoke-PreCommitReleasePreflight');
    expect(releaseScript).toContain("if ($skipHooks -notcontains 'no-commit-to-branch')");
    expect(releaseScript).toContain('pre-commit run --all-files');
    expect(releaseScript).toContain('Remove-Item Env:\\SKIP');
  });
});
