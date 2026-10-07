// forever-ledger-discord (PM2): the Discord bot. Secrets come from deploy/.env through the PM2 ecosystem file.
import Anthropic from '@anthropic-ai/sdk';
import { pino } from 'pino';
import { ledgerAsker } from './ask.js';
import { startBot } from './bot.js';
import { limitFrom } from './question.js';

process.env.TZ ??= 'America/Chicago';

const need = (name: string) => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
};
const ids = (name: string) =>
  new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s)),
  );

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: () =>
    `,"time":"${new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')}"`,
});

const guildIds = ids('DISCORD_GUILD_IDS');
if (guildIds.size === 0)
  throw new Error('DISCORD_GUILD_IDS is required (the server ids the bot answers in)');
// One retry at most: a timed-out Opus answer is not worth paying for three times.
const anthropic = new Anthropic({ apiKey: need('ANTHROPIC_API_KEY'), maxRetries: 1 });
const ask = ledgerAsker(
  {
    mcpUrl: process.env.LEDGER_MCP_URL ?? 'https://ledger.willikers.dev/mcp',
    readToken: need('LEDGER_DISCORD_READ_TOKEN'),
    adminToken: process.env.LEDGER_DISCORD_ADMIN_TOKEN?.trim() || undefined,
  },
  (params) => anthropic.beta.messages.create(params),
);

const client = startBot(
  {
    token: need('DISCORD_BOT_TOKEN'),
    adminRoleIds: ids('DISCORD_ADMIN_ROLE_IDS'),
    guildIds,
    limits: {
      perHour: limitFrom(process.env.DISCORD_QUESTIONS_PER_HOUR, 20),
      opusPerHour: limitFrom(process.env.DISCORD_OPUS_PER_HOUR, 5),
      allPerHour: limitFrom(process.env.DISCORD_ALL_QUESTIONS_PER_HOUR, 60),
      allOpusPerHour: limitFrom(process.env.DISCORD_ALL_OPUS_PER_HOUR, 10),
    },
  },
  ask,
  log,
);

const shutdown = (signal: string) => {
  log.info({ signal }, 'shutting down');
  void client.destroy().finally(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
