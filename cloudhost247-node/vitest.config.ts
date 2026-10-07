import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * One Vitest project covers two kinds of tests:
 *   - tests/**  — backend (Fastify/Postgres) tests, run in a plain Node environment.
 *   - frontend/tests/** — React component tests (Header nav, RequireAuth, etc.), run in jsdom
 *     via @testing-library/react so real DOM/click/render behavior is exercised, not just
 *     TypeScript types.
 * `environmentMatchGlobs` picks the right environment per file without needing two separate
 * Vitest configs/projects.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts', 'frontend/tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['frontend/**', 'jsdom']],
    setupFiles: ['./frontend/tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
