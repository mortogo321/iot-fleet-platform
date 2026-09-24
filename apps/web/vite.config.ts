import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dependency-free config: no node imports. `new URL(...).pathname` resolves the
// shared package path relative to this file without touching `path`/`fs`.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@iot/shared': new URL('../../packages/shared/src', import.meta.url).pathname,
    },
  },
  build: {
    // Vendor-split the 640kB+ bundle (react + recharts) for better caching.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: 'vendor-charts', test: /node_modules\/(recharts|d3-.+|victory-vendor)\// },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'http://localhost:8080', ws: true },
    },
  },
});
