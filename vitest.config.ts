import { configDefaults,defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': projectRoot,
    },
  },
  test: {
    exclude:[...configDefaults.exclude,'.superpowers/**'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    maxWorkers: 2,
  },
});
