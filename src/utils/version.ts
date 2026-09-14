import fs from 'fs';
import path from 'path';

const MAX_VERSION_LENGTH = 100;

function isValidVersion(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_VERSION_LENGTH;
}

function walkUpForPackageJson(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, 'package.json');
    try {
      if (fs.existsSync(candidate)) {
        const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (isValidVersion(raw?.version)) return raw.version;
      }
    } catch { /* per-candidate: try next */ }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return undefined;
}

export function findPackageVersion(callerDirname: string): string {
  // Self-location walk first: the server's own package.json is authoritative.
  // Under MCP stdio launch, cwd is the client's directory — its package.json
  // would shadow the server's version, which is strictly worse than 0.0.0
  // because it is undetectable.
  const selfVersion = walkUpForPackageJson(callerDirname);
  if (selfVersion) return selfVersion;

  // cwd fallback
  try {
    const cwdPkg = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(cwdPkg)) {
      const raw = JSON.parse(fs.readFileSync(cwdPkg, 'utf8'));
      if (isValidVersion(raw?.version)) return raw.version;
    }
  } catch { /* try next */ }

  try {
    process.stderr.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'WARN',
      msg: `[version] could not resolve package version from callerDirname=${callerDirname}, cwd=${process.cwd()}. Reporting 0.0.0.`,
      pid: process.pid
    }) + '\n');
  } catch { /* best-effort */ }
  return '0.0.0';
}
