// The Discord side: an @mention starts a thread on the question and answers there; an @mention inside one of the bot's
// threads continues it with the thread as context. Without the privileged Message Content intent Discord only gives the
// bot the text of messages that mention it and of its own messages (fetched history too: other messages come back
// empty and drop out), so the context is exactly the questions put to it and its answers. Nothing is stored. Adding
// the intent would change that: every thread message would join the context.
import type Anthropic from '@anthropic-ai/sdk';
import { Client, Events, GatewayIntentBits, ThreadAutoArchiveDuration } from 'discord.js';
import type { Message, ThreadChannel } from 'discord.js';
import type { Logger } from 'pino';
import type { AskInput, Answer } from './ask.js';
import { parseQuestion, rateLimiter, splitForDiscord, threadName } from './question.js';
import type { Limits } from './question.js';

/** Earlier thread messages sent along as context (the newest ones). */
const THREAD_CONTEXT = 20;
/** Discord shows "typing…" for 10 s; refresh it while Claude works. */
const TYPING_EVERY_MS = 8_000;

export interface BotConfig {
  token: string;
  /** Discord role ids whose members may log observations. */
  adminRoleIds: Set<string>;
  /** Servers the bot answers in (required: an invite to another server never runs up the bill). */
  guildIds: Set<string>;
  limits: Limits;
}

export interface ContextTurn {
  authorId: string;
  message: Anthropic.Beta.BetaMessageParam;
}

/**
 * A thread message as conversation context: the bot's own are its answers, everyone else's are questions, labelled
 * with the author's display name (a label, not an identity: nicknames are anyone's to set).
 */
export function toContext(
  m: { authorId: string; authorName: string; content: string },
  botId: string,
): ContextTurn | null {
  if (m.authorId === botId) {
    return m.content.trim()
      ? { authorId: m.authorId, message: { role: 'assistant', content: m.content } }
      : null;
  }
  const q = parseQuestion(m.content);
  return q
    ? { authorId: m.authorId, message: { role: 'user', content: `${m.authorName}: ${q.text}` } }
    : null;
}

/** Conversation for Claude: must start with a user turn (an answer can't come first). */
export function conversation(context: ContextTurn[]) {
  const first = context.findIndex((t) => t.message.role === 'user');
  return first === -1 ? [] : context.slice(first);
}

/**
 * Whether the admin token may be used: an admin asking, in a conversation where every question is theirs. Anyone
 * else's message in the context could steer what gets logged, so then the answer is read-only.
 */
export function mayWrite(isAdmin: boolean, turns: ContextTurn[], askerId: string, botId: string) {
  return isAdmin && turns.every((t) => t.authorId === askerId || t.authorId === botId);
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function startBot(
  config: BotConfig,
  ask: (input: AskInput) => Promise<Answer>,
  log: Logger,
) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    // Answers never ping anyone, whatever they contain.
    allowedMentions: { parse: [], repliedUser: false },
  });
  const limits = rateLimiter(config.limits);

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
      .filter((t): t is ContextTurn => t !== null);
  }

  async function handle(message: Message) {
    const me = client.user;
    if (!me || message.author.bot || !message.inGuild()) return;
    if (!config.guildIds.has(message.guildId)) return;
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
    const isAdmin = message.member?.roles.cache.some((r) => config.adminRoleIds.has(r.id)) ?? false;

    // In one of the bot's own threads, continue it; anywhere else, start a thread on the question.
    const inOwnThread = message.channel.isThread() && message.channel.ownerId === me.id;
    let thread: Pick<ThreadChannel, 'send' | 'sendTyping'>;
    if (message.channel.isThread() || !('send' in message.channel)) {
      thread = message.channel as ThreadChannel;
    } else {
      // No thread permission (or a channel type without threads): answer in the channel instead.
      thread = await message
        .startThread({
          name: threadName(question.text),
          autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        })
        .catch((err: unknown) => {
          log.warn({ err: errText(err) }, 'no thread; answering in channel');
          return message.channel as unknown as ThreadChannel;
        });
    }
    const asker = message.member?.displayName ?? message.author.username;

    const typing = setInterval(
      () => void thread.sendTyping().catch(() => undefined),
      TYPING_EVERY_MS,
    );
    void thread.sendTyping().catch(() => undefined);
    const started = Date.now();
    try {
      // History that can't be read (a missing permission) just means no context, not no answer.
      const context = inOwnThread
        ? await threadContext(message.channel as ThreadChannel, me.id, message.id).catch(
            (err: unknown) => {
              log.warn({ err: errText(err) }, 'no thread history');
              return [];
            },
          )
        : [];
      const turns = conversation([
        ...context,
        {
          authorId: message.author.id,
          message: { role: 'user', content: `${asker}: ${question.text}` },
        },
      ]);
      const admin = mayWrite(isAdmin, turns, message.author.id, me.id);
      const answer = await ask({
        messages: turns.map((t) => t.message),
        opus: question.opus,
        admin,
      });
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
      log.error({ err: errText(err) }, 'answer failed');
      // If even this can't be sent (no permission to post here), say it where the question was asked.
      await thread
        .send('Something went wrong on my end; try again in a minute.')
        .catch(() => message.reply("I couldn't answer here; check my channel permissions."))
        .catch(() => undefined);
    } finally {
      clearInterval(typing);
    }
  }

  client.on(Events.MessageCreate, (message) => {
    handle(message).catch((err: unknown) =>
      log.error({ err: errText(err) }, 'message handling failed'),
    );
  });
  client.once(Events.ClientReady, (c) =>
    log.info({ user: c.user.tag, guilds: c.guilds.cache.size }, 'discord bot ready'),
  );
  void client.login(config.token);
  return client;
}
