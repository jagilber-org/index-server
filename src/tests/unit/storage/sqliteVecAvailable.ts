/**
 * Shared guard for sqlite-vec test suites.
 *
 * Returns false on musl/Alpine (sqlite-vec ships glibc-only binaries)
 * or any other environment where the native module cannot load.
 */
export const hasSqliteVec: boolean = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sv = require('sqlite-vec') as { getLoadablePath: () => string };
    sv.getLoadablePath(); // ensure the binary actually resolves
    return true;
  } catch {
    return false;
  }
})();
