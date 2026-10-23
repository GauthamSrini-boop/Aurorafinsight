import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately on :4000; the proxy keeps requests same-origin
// so the HttpOnly session cookie works exactly like it does in production.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false },
});
