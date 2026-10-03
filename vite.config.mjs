import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5183, strictPort: true, watch: { ignored: ['**/release/**', '**/dist/**'] } },
  build: { outDir: 'dist', target: 'esnext', chunkSizeWarningLimit: 2000 },
});
