/**
 * Shared zip-based backup utilities.
 *
 * All backup producers (autoBackup, bulk-delete, AdminPanel) converge here
 * so there is a single implementation for creating, reading, and extracting
 * zip backup archives.
 */
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

/** Create a zip from every .json file in `sourceDir`. Returns the written zip path. */
export function createZipBackup(sourceDir: string, outputZipPath: string): { zipPath: string; fileCount: number } {
  const zip = new AdmZip();
  const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    zip.addLocalFile(path.join(sourceDir, f));
  }
  zip.writeZip(outputZipPath);
  return { zipPath: outputZipPath, fileCount: files.length };
}

/**
 * Create a zip that also includes a manifest.json entry.
 * The manifest is written as an in-memory entry (not read from disk).
 */
export function createZipBackupWithManifest(
  sourceDir: string,
  outputZipPath: string,
  manifest: Record<string, unknown>,
): { zipPath: string; fileCount: number } {
  const zip = new AdmZip();
  const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    zip.addLocalFile(path.join(sourceDir, f));
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.writeZip(outputZipPath);
  return { zipPath: outputZipPath, fileCount: files.length };
}

/** Extract all .json files from a zip into `targetDir`. Returns count of extracted files. */
export function extractZipBackup(zipPath: string, targetDir: string): number {
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  let count = 0;
  for (const entry of zip.getEntries()) {
    const name = path.basename(entry.entryName);
    if (!name.toLowerCase().endsWith('.json')) continue;
    if (name === 'manifest.json') continue;
    if (name.includes('..') || name !== entry.entryName) continue; // path traversal guard
    fs.writeFileSync(path.join(targetDir, name), entry.getData());
    count++;
  }
  return count;
}

/** Read and parse the manifest.json from inside a zip (if present). */
export function readZipManifest(zipPath: string): Record<string, unknown> | null {
  try {
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntry('manifest.json');
    if (!entry) return null;
    return JSON.parse(entry.getData().toString('utf-8'));
  } catch {
    return null;
  }
}

/** List .json filenames inside a zip (excluding manifest.json). */
export function listZipInstructionFiles(zipPath: string): string[] {
  const zip = new AdmZip(zipPath);
  return zip.getEntries()
    .map(e => e.entryName)
    .filter(n => n.toLowerCase().endsWith('.json') && n !== 'manifest.json');
}

/** Read a single file from a zip as parsed JSON. */
export function readZipEntry(zipPath: string, entryName: string): unknown | null {
  try {
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntry(entryName);
    if (!entry) return null;
    return JSON.parse(entry.getData().toString('utf-8'));
  } catch {
    return null;
  }
}

/** Get size of a zip file in bytes. */
export function getZipSizeBytes(zipPath: string): number {
  try {
    return fs.statSync(zipPath).size;
  } catch {
    return 0;
  }
}

/** Check whether a path is a zip backup (by extension). */
export function isZipBackup(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.zip');
}
