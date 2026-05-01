import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Global ignores (replaces ignorePatterns + .eslintignore)
  {
    ignores: [
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
      'scripts/analyze-traces.js',
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
