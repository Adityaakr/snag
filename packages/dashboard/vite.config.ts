import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Workspace packages resolve to their TypeScript sources.
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  build: { outDir: 'dist', emptyOutDir: true, assetsDir: 'assets' },
  server: { proxy: { '/api': 'http://localhost:3000', '/auth': 'http://localhost:3000' } },
});
