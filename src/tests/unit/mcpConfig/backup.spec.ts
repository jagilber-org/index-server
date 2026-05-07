import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBackup, readManifest, restoreBackup } from '../../../services/mcpConfig/backup';

function tempFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-backup-unit-'));
  return path.join(dir, name);
}

describe('mcpConfig backup manifest, restore, and retention', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a manifest entry with sha256 metadata before mutation', () => {
    const filePath = tempFile('mcp.json');
    fs.writeFileSync(filePath, '{"servers":{}}\n', 'utf8');
    const backup = createBackup(filePath, 'upsert', 'index-server');
    expect(backup?.operation).toBe('upsert');
    expect(backup?.serverName).toBe('index-server');
    expect(backup?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(backup?.backupPath ?? '')).toBe(true);
    expect(readManifest(filePath).entries).toHaveLength(1);
  });

  it('restores the latest backup and creates a restore preimage backup', () => {
    const filePath = tempFile('mcp.json');
    fs.writeFileSync(filePath, '{"servers":{"before":{}}}\n', 'utf8');
    const first = createBackup(filePath, 'upsert', 'index-server');
    fs.writeFileSync(filePath, '{"servers":{"after":{}}}\n', 'utf8');
    const restored = restoreBackup(filePath);
    expect(restored.backupPath).toBe(first?.backupPath);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"servers":{"before":{}}}\n');
    expect(readManifest(filePath).entries.some(entry => entry.operation === 'restore-preimage')).toBe(true);
  });

  it('rotates retention per target file without deleting other target manifests', () => {
    vi.stubEnv('INDEX_SERVER_MCP_BACKUP_RETAIN', '2');
    const vscodePath = tempFile('mcp.json');
    const copilotPath = tempFile('mcp-config.json');
    fs.writeFileSync(vscodePath, '{"servers":{}}\n', 'utf8');
    fs.writeFileSync(copilotPath, '{"mcpServers":{}}\n', 'utf8');

    for (let i = 0; i < 4; i += 1) {
      fs.writeFileSync(vscodePath, `{"servers":{"v${i}":{}}}\n`, 'utf8');
      createBackup(vscodePath, 'upsert', 'index-server');
    }
    createBackup(copilotPath, 'remove', 'index-server');

    expect(readManifest(vscodePath).entries).toHaveLength(2);
    expect(readManifest(copilotPath).entries).toHaveLength(1);
  });
});
