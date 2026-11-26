// Lint for the whole monorepo, run from the root by `pnpm lint` (with dependency-cruiser, see .dependency-cruiser.mjs).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  // ADR-011 "Как се проверява": drizzle-orm (and with it raw SQL) only in *.repository.ts, *.queries.ts and common/db.
  {
    files: ['apps/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/*'],
              message:
                'drizzle-orm is allowed only in *.repository.ts, *.queries.ts and apps/api/src/common/db (ADR-011 Модули и собственост на данните).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.repository.ts', 'apps/api/src/**/*.queries.ts', 'apps/api/src/common/db/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
