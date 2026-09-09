export default [
  {
    files: ['src/**/*.js', 'worker/src/**/*.js', 'tests/**/*.js', 'evals/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Browser + extension
        window: 'readonly', document: 'readonly', location: 'readonly', history: 'readonly',
        chrome: 'readonly', fetch: 'readonly', console: 'readonly', crypto: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', btoa: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', AbortController: 'readonly',
        MutationObserver: 'readonly', Event: 'readonly', Headers: 'readonly',
        Response: 'readonly', HTMLElement: 'readonly', globalThis: 'readonly',
        Request: 'readonly', TextEncoder: 'readonly',
        // Node (build + eval scripts)
        process: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
];
