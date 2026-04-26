import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'server.json'), 'utf8'));

describe('MCP registry manifest', () => {
  it('package.json declares mcpName', () => {
    expect(pkg.mcpName).toBe('io.github.jagilber-org/index-server');
  });

  it('server.json name matches package.json mcpName', () => {
    expect(manifest.name).toBe(pkg.mcpName);
  });

  it('server.json version matches package.json version', () => {
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.packages?.[0]?.version).toBe(pkg.version);
  });

  it('server.json declares at least one distributable package', () => {
    expect(Array.isArray(manifest.packages)).toBe(true);
    expect(manifest.packages.length).toBeGreaterThan(0);
  });

  it('server.json npm identifier matches package.json name', () => {
    expect(manifest.packages?.[0]?.identifier).toBe(pkg.name);
  });

  it('server.json declares stdio transport', () => {
    expect(manifest.packages?.[0]?.transport?.type).toBe('stdio');
  });

  it('package.json files includes server.json so npm pack ships registry metadata', () => {
    expect(pkg.files).toContain('server.json');
  });

  it('repository URLs stay aligned across package metadata and server manifest', () => {
    const packageRepoUrl = String(pkg.repository?.url ?? '').replace(/\.git$/, '');
    expect(manifest.repository?.url).toBe(packageRepoUrl);
    expect(manifest.repository?.source).toBe('github');
  });
});
