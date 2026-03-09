import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  define: {
    '__GOOGLE_OAUTH_CLIENT_ID_ENC__': JSON.stringify(''),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**/*.test.ts', 'node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'tests/**',
        '**/*.d.ts',
        '**/*.config.ts',
        '**/index.ts',
        'src/renderer.ts', // Renderer entry, tested via e2e
        'src/renderer/**', // Renderer tests need different environment
        'src/main/index.ts', // App initialization, tested via e2e
        'src/main/window/**', // Window management, tested via e2e
        'src/main/ipc/channels.ts', // Just constants
        'src/preload/**', // Preload scripts, tested via e2e
        '.vite/**', // Build artifacts
        'src/shared/types/**', // Type definitions only
        'src/plugins/types/**', // Type definitions only
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@plugins': path.resolve(__dirname, 'src/plugins'),
    },
  },
});
