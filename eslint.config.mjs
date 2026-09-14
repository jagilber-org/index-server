import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Global ignores (replaces ignorePatterns + .eslintignore)
  {
    ignores: [
      '.claude/**',
      'dist/**',
      'node_modules/**',
      'release/**',
      '**/tmp/**',
      '.codeql/**',
      '.copilot/**',
      '.squad/**',
      '.squad-templates/**',
      'vitest.config.ts',
      'vitest.config.unit.ts',
      '.eslintrc.cjs',
      'src/tests._park/**',
      'src/tests._legacy/**',
      'scripts/guard-declarations.mjs',
      'scripts/purge-extra-decls.mjs',
      'scripts/performanceBaseline.ts',
      'scripts/analyze-traces.mjs',
      '*.log',
      // Vendored/minified client libraries
      'src/dashboard/client/js/chart.umd.js',
      'src/dashboard/client/js/elk.bundled.js',
      'src/dashboard/client/js/marked.umd.js',
      'src/dashboard/client/js/mermaid.min.js',
    ],
  },

  // Base recommended configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Default TypeScript config for all source files
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: {
        project: './tsconfig.eslint.json',
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  // ── CQ-1: file size ────────────────────────────────────────────────
  //
  // Constitution CQ-1 says source files "SHOULD target <=600 lines; MUST NOT
  // exceed 1000". Nothing enforced it (#585), so four files had drifted past
  // the hard limit and twelve more sat in the 600-1000 warning band.
  //
  // Tests are excluded: a spec's length is table-driven, and truncating one
  // to satisfy a style rule trades coverage for tidiness.
  {
    files: ['src/**/*.ts', 'src/dashboard/client/js/**/*.js', 'scripts/**/*.mjs', 'scripts/**/*.cjs', 'scripts/**/*.js', 'scripts/**/*.ts'],
    ignores: ['src/tests/**'],
    rules: {
      'max-lines': ['error', { max: 1000, skipBlankLines: false, skipComments: false }],
    },
  },

  // CQ-1 ratchet. These five predate the rule. Each cap is the file's EXACT
  // current length, so the file cannot grow by a single line -- the same
  // shrink-only shape as scripts/governance/config-usage-baseline.json.
  // `check-constitution-enforcement.mjs` fails if one of these files shrinks
  // and the cap is left behind, so the ratchet cannot rust into a waiver.
  { files: ['src/dashboard/server/AdminPanel.ts'], rules: { 'max-lines': ['error', { max: 1190, skipBlankLines: false, skipComments: false }] } },
  { files: ['src/dashboard/server/MetricsCollector.ts'], rules: { 'max-lines': ['error', { max: 1086, skipBlankLines: false, skipComments: false }] } },
  { files: ['src/services/indexContext.ts'], rules: { 'max-lines': ['error', { max: 1021, skipBlankLines: false, skipComments: false }] } },
  { files: ['src/services/handlers.search.ts'], rules: { 'max-lines': ['error', { max: 1012, skipBlankLines: false, skipComments: false }] } },
  { files: ['src/dashboard/client/js/admin.instructions.js'], rules: { 'max-lines': ['error', { max: 1234, skipBlankLines: false, skipComments: false }] } },

  // Parked legacy tests: disable typed project parsing
  {
    files: ['src/tests._park/**/*.ts', 'src/tests._park/**/*.tsx'],
    languageOptions: {
      parserOptions: { project: null },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Global test setup file
  {
    files: ['src/tests/setupDistReady.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Scripts (.cjs, .js, .ts, .mjs) — no typed project parsing
  {
    files: ['scripts/**/*.cjs', 'scripts/**/*.js', 'scripts/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { project: null },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Declaration files: disable typed-linting
  {
    files: ['**/*.d.ts'],
    languageOptions: {
      parserOptions: { project: null },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Spec/test files
  {
    files: ['src/tests/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Client-side extracted JS modules: plain JS, browser env
  {
    files: ['src/dashboard/client/js/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { project: null },
    },
  },

  // Root-level CJS files and test JS files: Node globals, no typed parsing
  {
    files: ['*.cjs', 'tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { project: null },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Playwright e2e test files
  {
    files: ['tests/playwright/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: {
        project: './tsconfig.eslint.json',
        sourceType: 'module',
      },
    },
  },
);
