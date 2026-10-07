// The Discord side: an @mention starts a thread on the question and answers there; an @mention inside one of the bot's
// threads continues it with the thread as context. Message content is read only from those messages (mentions reach
// the bot without the privileged Message Content intent) and is never stored.
import type Anthropic from '@anthropic-ai/sdk';
import { Client, Events, GatewayIntentBits, Partials, ThreadAutoArchiveDuration } from 'discord.js';
import type { Message, ThreadChannel } from 'discord.js';
import type { Logger } from 'pino';
import type { AskInput, Answer } from './ask.js';
import { parseQuestion, rateLimiter, splitForDiscord, threadName } from './question.js';

/** Earlier thread messages sent along as context (the newest ones). */
const THREAD_CONTEXT = 20;
/** Discord shows "typing…" for 10 s; refresh it while Claude works. */
const TYPING_EVERY_MS = 8_000;

export interface BotConfig {
  token: string;
  /** Discord role ids whose members may log observations. */
  adminRoleIds: Set<string>;
  /** Servers the bot answers in (empty: any server it is in). */
  guildIds: Set<string>;
  perHour: number;
  opusPerHour: number;
}

/** A thread message as conversation context: the bot's own are its answers, everyone else's are questions. */
export function toContext(
  m: { authorId: string; authorName: string; content: string },
  botId: string,
): Anthropic.Beta.BetaMessageParam | null {
  if (m.authorId === botId) {
    return m.content.trim() ? { role: 'assistant', content: m.content } : null;
  }
  const q = parseQuestion(m.content);
  return q ? { role: 'user', content: `${m.authorName}: ${q.text}` } : null;
}

/** Conversation for Claude: must start with a user turn (an answer can't come first). */
export function conversation(context: Anthropic.Beta.BetaMessageParam[]) {
  const first = context.findIndex((m) => m.role === 'user');
  return first === -1 ? [] : context.slice(first);
}

export function startBot(
  config: BotConfig,
  ask: (input: AskInput) => Promise<Answer>,
  log: Logger,
) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel],
    // Answers never ping anyone, whatever they contain.
    allowedMentions: { parse: [], repliedUser: false },
  });
  const limits = rateLimiter(config.perHour, config.opusPerHour);

  async function threadContext(thread: ThreadChannel, botId: string, before: string) {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    const fetched = await thread.messages.fetch({ limit: THREAD_CONTEXT, before });
    const msgs = [...fetched.values()].reverse();
    return [...(starter ? [starter] : []), ...msgs]
      .map((m) =>
        toContext(
          {
            authorId: m.author.id,
            authorName: m.member?.displayName ?? m.author.username,
            content: m.content,
          },
          botId,
        ),
      )
      .filter((m): m is Anthropic.Beta.BetaMessageParam => m !== null);
  }

  async function handle(message: Message) {
    const me = client.user;
    if (!me || message.author.bot || !message.inGuild()) return;
    if (config.guildIds.size > 0 && !config.guildIds.has(message.guildId)) return;
    // A direct @mention of the bot only (not @everyone or a role).
    if (!message.mentions.users.has(me.id)) return;
    const question = parseQuestion(message.content);
    if (!question) {
      await message.reply(
        'Ask me something about WoW: Forever, like "where do I get Black Pearls?"',
      );
      return;
    }
    const why = limits.take(message.author.id, question.opus);
    if (why) {
      await message.reply(`Hold up: ${why}.`);
      return;
    }
    const admin = message.member?.roles.cache.some((r) => config.adminRoleIds.has(r.id)) ?? false;

    // In one of the bot's own threads, continue it; anywhere else, start a thread on the question.
    const inOwnThread = message.channel.isThread() && message.channel.ownerId === me.id;
    let thread: Pick<ThreadChannel, 'send' | 'sendTyping'>;
    let context: Anthropic.Beta.BetaMessageParam[] = [];
    if (inOwnThread) {
      thread = message.channel as ThreadChannel;
      context = await threadContext(message.channel as ThreadChannel, me.id, message.id);
    } else if (message.channel.isThread() || !('send' in message.channel)) {
      thread = message.channel as ThreadChannel;
    } else {
      // No thread permission (or a channel type without threads): answer in the channel instead.
      thread = await message
        .startThread({
          name: threadName(question.text),
          autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        })
        .catch((err: unknown) => {
          log.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'no thread; answering in channel',
          );
          return message.channel as unknown as ThreadChannel;
        });
    }
    const asker = message.member?.displayName ?? message.author.username;
    const messages = conversation([
      ...context,
      { role: 'user', content: `${asker}: ${question.text}` },
    ]);

    const typing = setInterval(
      () => void thread.sendTyping().catch(() => undefined),
      TYPING_EVERY_MS,
    );
    void thread.sendTyping().catch(() => undefined);
    const started = Date.now();
    try {
      const answer = await ask({ messages, opus: question.opus, admin });
      const text = question.truncated
        ? `${answer.text}\n_(your question was long, so I only read the first part)_`
        : answer.text;
      for (const part of splitForDiscord(text)) await thread.send(part);
      log.info(
        {
          guild: message.guildId,
          user: message.author.id,
          admin,
          model: answer.model,
          stop: answer.stopReason,
          tokens: answer.usage,
          ms: Date.now() - started,
        },
        'answered',
      );
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'answer failed');
      await thread
        .send('Something went wrong on my end; try again in a minute.')
        .catch(() => undefined);
    } finally {
      clearInterval(typing);
    }
  }

  client.on(Events.MessageCreate, (message) => {
    handle(message).catch((err: unknown) =>
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'message handling failed',
      ),
    );
  });
  client.once(Events.ClientReady, (c) =>
    log.info({ user: c.user.tag, guilds: c.guilds.cache.size }, 'discord bot ready'),
  );
  void client.login(config.token);
  return client;
}
