import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'scripts/**',
        'dist/**',
  'docs/**',
        'data/**',
        'snapshots/**',
        'tmp/**',
  'src/perf/**',
  'src/server/transport.ts',
        '**/*.d.ts'
      ]
    }
  }
});
