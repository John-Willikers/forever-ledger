import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'fixtures/**',
      'addon/**',
      'apps/desktop/release/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // CommonJS config files (PM2 ecosystem)
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The uploader's root entry pulls in commander and reads package.json at load, which breaks the bundle.
    files: ['apps/desktop/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@forever-ledger/uploader',
              message: 'Import @forever-ledger/uploader/lib in the desktop app.',
            },
          ],
        },
      ],
    },
  },
  {
    // Electron renderer: runs in the browser sandbox
    files: ['apps/desktop/src/renderer/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
