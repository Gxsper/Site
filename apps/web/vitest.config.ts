import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      // Siehe test/server-only.ts — nur fuer Tests, nicht fuer den Build.
      'server-only': path.resolve(import.meta.dirname, 'test/server-only.ts'),
    },
  },
});
