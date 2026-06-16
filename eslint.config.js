// Flat config — runs at the monorepo root, scopes apply per-app.
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';
import vuePlugin from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'backend/prisma/migrations/**',
      // Node build/runtime scripts (CommonJS / plain Node) — not app source.
      'frontend/electron/**',
      'scripts/**',
      'build-backend.js',
      'pumb-version.js',
      'dist-backend/**',
      'release/**',
      'release-client/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['frontend/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { vue: vuePlugin, '@typescript-eslint': tseslint },
    rules: {
      ...vuePlugin.configs['vue3-recommended'].rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // TypeScript (and Vue <script lang="ts">) makes these core ESLint rules
    // redundant or wrong: the compiler already flags undefined identifiers, and
    // the `export const X` + `export type X` merge pattern trips no-redeclare.
    // Unused vars are handled by the type-aware @typescript-eslint rule above.
    files: ['**/*.{ts,tsx,vue}'],
    rules: {
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off',
    },
  },
  prettier,
];
