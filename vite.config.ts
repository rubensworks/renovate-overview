import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The app is deployed to a GitHub Pages project subpath (https://<user>.github.io/renovate-overview/),
// so all asset URLs are emitted relative to index.html.
export default defineConfig({
  base: './',
  plugins: [ react() ],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    include: [ 'test/**/*.test.ts', 'test/**/*.test.tsx' ],
    setupFiles: [ './test/setup.ts' ],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: [ 'src/**' ],
      reporter: [ 'text', 'html', 'lcov' ],
      // The suite is expected to cover every line, branch and function of the app.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
