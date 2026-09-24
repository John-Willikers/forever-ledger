// PM2 config for the Forever Ledger API. Nginx (ledger.willikers.dev) proxies to 127.0.0.1:3410.
// Usage: pnpm build && pm2 start deploy/ecosystem.config.cjs && pm2 save
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
try {
  process.loadEnvFile(envFile);
} catch {
  console.warn(`forever-ledger: ${envFile} not found; using the current environment`);
}

module.exports = {
  apps: [
    {
      name: 'forever-ledger-api',
      cwd: path.join(__dirname, '..', 'apps', 'server'),
      script: 'dist/main.js',
      node_args: '--enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      time: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Chicago',
        DATABASE_URL: process.env.DATABASE_URL,
        HOST: process.env.HOST || '127.0.0.1',
        PORT: process.env.PORT || '3410',
        BODY_LIMIT: process.env.BODY_LIMIT,
        INGEST_PER_MINUTE: process.env.INGEST_PER_MINUTE,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        // Admin panel (Battle.net login). Secrets live only in deploy/.env.
        BNET_CLIENT_ID: process.env.BNET_CLIENT_ID,
        BNET_CLIENT_SECRET: process.env.BNET_CLIENT_SECRET,
        BNET_REDIRECT_URI: process.env.BNET_REDIRECT_URI,
        ADMIN_BATTLETAGS: process.env.ADMIN_BATTLETAGS,
        ADMIN_BNET_SUBS: process.env.ADMIN_BNET_SUBS,
        COOKIE_SECRET: process.env.COOKIE_SECRET,
        COOKIE_INSECURE: process.env.COOKIE_INSECURE,
        ADMIN_DIST_DIR: process.env.ADMIN_DIST_DIR,
      },
    },
  ],
};
