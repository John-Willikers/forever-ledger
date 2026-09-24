import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The API the dev server proxies to (run apps/server locally, see README "Admin panel"). */
const api = process.env.LEDGER_API ?? 'http://127.0.0.1:3410';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': api, '/admin/api': api, '/admin/auth': api },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
