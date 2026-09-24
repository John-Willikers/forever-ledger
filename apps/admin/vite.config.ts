import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The API the dev server proxies to (run apps/server locally, see README "Admin panel"). */
const api = process.env.LEDGER_API ?? 'http://127.0.0.1:3410';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    // /admin/maps/<id> are the zone map images; /admin/maps itself is the Maps page (the SPA).
    proxy: { '/v1': api, '/admin/api': api, '/admin/auth': api, '^/admin/maps/.+': api },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The chart pages' chunk carries ECharts (core + bar/line, ~550 kB, lazy-loaded); everything else is small.
    chunkSizeWarningLimit: 600,
  },
});
