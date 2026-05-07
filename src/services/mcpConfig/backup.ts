import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface BackupManifestEntry {
  originalPath: string;
  backupPath: string;
  sha256: string;
  timestamp: string;
  operation: string;
  serverName?: string;
}

export interface BackupManifest {
  version: 1;
  entries: BackupManifestEntry[];
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestampForFile(): string {
  return `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.${crypto.randomBytes(4).toString('hex')}`;
}

function backupDirFor(filePath: string): string {
  return path.join(path.dirname(filePath), '.mcp-backups');
}

function manifestPathFor(filePath: string): string {
  return path.join(backupDirFor(filePath), 'manifest.json');
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function retentionLimit(): number {
  const raw = process.env.INDEX_SERVER_MCP_BACKUP_RETAIN;
  const parsed = raw ? Number(raw) : 10;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10;
}

export function atomicWriteText(filePath: string, text: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readManifest(filePath: string): BackupManifest {
  const manifestPath = manifestPathFor(filePath);
  if (!fs.existsSync(manifestPath)) return { version: 1, entries: [] };
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
  if (!Array.isArray(parsed.entries)) throw new Error(`Invalid MCP backup manifest: ${manifestPath}`);
  return { version: 1, entries: parsed.entries };
}

function writeManifest(filePath: string, manifest: BackupManifest): void {
  atomicWriteText(manifestPathFor(filePath), `${JSON.stringify(manifest, null, 2)}\n`);
}

function rotateBackups(filePath: string, manifest: BackupManifest, retain: number): BackupManifest {
  const targetKey = path.resolve(filePath);
  const matching = manifest.entries.filter(entry => path.resolve(entry.originalPath) === targetKey);
  const removable = matching.slice(0, Math.max(0, matching.length - retain));
  const removableSet = new Set<BackupManifestEntry>(removable);
  for (const entry of removable) {
    try {
      if (fs.existsSync(entry.backupPath)) fs.unlinkSync(entry.backupPath);
    } catch {
      throw new Error(`Failed to remove rotated MCP backup: ${entry.backupPath}`);
    }
  }
  return {
    version: 1,
    entries: manifest.entries.filter(entry => !removableSet.has(entry)),
  };
}

export function createBackup(filePath: string, operation: string, serverName?: string): BackupManifestEntry | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const content = fs.readFileSync(filePath, 'utf8');
  const timestamp = timestampForFile();
  const backupDir = backupDirFor(filePath);
  ensureDir(backupDir);
  const backupPath = path.join(backupDir, `${path.basename(filePath)}.${timestamp}.json`);
  const legacyBackupPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.backup.${timestamp}`);
  atomicWriteText(backupPath, content);
  atomicWriteText(legacyBackupPath, content);
  const manifest = readManifest(filePath);
  manifest.entries.push({
    originalPath: filePath,
    backupPath,
    sha256: sha256(content),
    timestamp: new Date().toISOString(),
    operation,
    serverName,
  });
  const rotated = rotateBackups(filePath, manifest, retentionLimit());
  writeManifest(filePath, rotated);
  return rotated.entries.find(entry => entry.backupPath === backupPath);
}

export function restoreBackup(filePath: string, backupPath?: string): BackupManifestEntry {
  const manifest = readManifest(filePath);
  const resolvedBackup = backupPath
    ? path.resolve(backupPath)
    : [...manifest.entries].reverse().find(entry => path.resolve(entry.originalPath) === path.resolve(filePath))?.backupPath;
  if (!resolvedBackup) throw new Error(`No MCP backup available for ${filePath}`);
  const entry = manifest.entries.find(item => path.resolve(item.backupPath) === path.resolve(resolvedBackup));
  if (!entry) throw new Error(`MCP backup is not present in manifest: ${resolvedBackup}`);
  if (!fs.existsSync(entry.backupPath)) throw new Error(`MCP backup file not found: ${entry.backupPath}`);
  const content = fs.readFileSync(entry.backupPath, 'utf8');
  if (sha256(content) !== entry.sha256) throw new Error(`MCP backup checksum mismatch: ${entry.backupPath}`);
  createBackup(filePath, 'restore-preimage');
  atomicWriteText(filePath, content);
  return entry;
}
