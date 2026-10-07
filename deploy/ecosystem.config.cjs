// PM2 config for the Forever Ledger API, MCP server and Discord bot. Nginx (ledger.willikers.dev) proxies /v1 and /admin to
// 127.0.0.1:3410 and /mcp to 127.0.0.1:3411.
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
    {
      // MCP server (project-plans/forever-ledger-mcp-server.md): answers only from the ledger, read tokens only.
      name: 'forever-ledger-mcp',
      cwd: path.join(__dirname, '..', 'apps', 'mcp'),
      script: 'dist/main.js',
      node_args: '--enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      time: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Chicago',
        DATABASE_URL: process.env.DATABASE_URL,
        MCP_HOST: process.env.MCP_HOST || '127.0.0.1',
        MCP_PORT: process.env.MCP_PORT || '3411',
        MCP_ALLOWED_HOSTS:
          process.env.MCP_ALLOWED_HOSTS || 'ledger.willikers.dev,localhost,127.0.0.1',
        MCP_PER_MINUTE: process.env.MCP_PER_MINUTE,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      },
    },
    {
      // Discord bot (project-plans/forever-ledger-discord-bot.md): @mention it, it answers from the ledger through
      // /mcp. Needs DISCORD_BOT_TOKEN, ANTHROPIC_API_KEY, DISCORD_GUILD_IDS and LEDGER_DISCORD_READ_TOKEN in deploy/.env:
      // start it with `pm2 start deploy/ecosystem.config.cjs --only forever-ledger-discord` once they are there (a
      // missing one stops it after a few tries instead of restarting forever).
      name: 'forever-ledger-discord',
      max_restarts: 5,
      min_uptime: '30s',
      restart_delay: 10000,
      cwd: path.join(__dirname, '..', 'apps', 'discord'),
      script: 'dist/main.js',
      node_args: '--enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      time: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Chicago',
        DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
        DISCORD_ADMIN_ROLE_IDS: process.env.DISCORD_ADMIN_ROLE_IDS,
        DISCORD_GUILD_IDS: process.env.DISCORD_GUILD_IDS,
        DISCORD_QUESTIONS_PER_HOUR: process.env.DISCORD_QUESTIONS_PER_HOUR,
        DISCORD_OPUS_PER_HOUR: process.env.DISCORD_OPUS_PER_HOUR,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        LEDGER_MCP_URL: process.env.LEDGER_MCP_URL,
        LEDGER_DISCORD_READ_TOKEN: process.env.LEDGER_DISCORD_READ_TOKEN,
        LEDGER_DISCORD_ADMIN_TOKEN: process.env.LEDGER_DISCORD_ADMIN_TOKEN,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      },
    },
  ],
};
