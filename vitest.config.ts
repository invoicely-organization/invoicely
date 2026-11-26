// Unit tests of the workspaces, run once from the root by `pnpm test` (vitest run, no watch).
// e2e/ is the repo-level suite and runs on node:test after this.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
  },
});
