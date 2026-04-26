import path from 'node:path';

export function validatePathContainment(filePath: string, allowedBase: string): string {
  const resolvedBase = path.resolve(allowedBase);
  const resolvedFile = path.resolve(filePath);
  if (resolvedFile === resolvedBase || resolvedFile.startsWith(resolvedBase + path.sep)) {
    return resolvedFile;
  }
  throw new Error(`Path escapes allowed base: ${resolvedFile}`);
}
