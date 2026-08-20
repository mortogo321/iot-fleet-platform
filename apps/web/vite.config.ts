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
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'http://localhost:8080', ws: true },
    },
  },
});
