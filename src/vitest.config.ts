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
        '**/*.d.ts'
      ]
    }
  }
});
