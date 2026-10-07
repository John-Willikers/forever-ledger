// The bot's pure parts and its Claude call, with a fake Messages API (no Discord, no network).
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, ledgerAsker, OPUS_MODEL } from '../src/ask.js';
import { conversation, toContext } from '../src/bot.js';
import { parseQuestion, rateLimiter, splitForDiscord, threadName } from '../src/question.js';

const config = {
  mcpUrl: 'https://ledger.example/mcp',
  readToken: 'flt_read',
  adminToken: 'flt_admin',
};

function fakeApi(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create = async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
    calls.push(structuredClone(params));
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return {
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      ...r,
    } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { calls, create };
}
const text = (t: string) =>
  [{ type: 'text', text: t, citations: null }] as Anthropic.Beta.BetaContentBlock[];
const question = [{ role: 'user' as const, content: 'Sam: where do I get Black Pearls?' }];

describe('questions', () => {
  it('drops the mention and takes --opus as a flag', () => {
    expect(parseQuestion('<@123456> where do I get Black Pearls? --opus')).toEqual({
      text: 'where do I get Black Pearls?',
      opus: true,
      truncated: false,
    });
    expect(parseQuestion('<@!123> --OPUS')).toBeNull();
    expect(parseQuestion('<@123> hi')?.opus).toBe(false);
    expect(parseQuestion(`<@1> ${'x'.repeat(2000)}`)).toMatchObject({ truncated: true });
    expect(threadName('a'.repeat(200))).toHaveLength(90);
  });

  it('splits long answers at line breaks, at most three messages', () => {
    const para = `${'word '.repeat(300)}\n\n`;
    const parts = splitForDiscord(para.repeat(10));
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);
    expect(parts[2]).toContain('answer cut short');
    expect(splitForDiscord('short')).toEqual(['short']);
  });

  it('limits questions per user per hour, Opus more tightly', () => {
    let now = 0;
    const limits = rateLimiter(3, 1, () => now);
    expect(limits.take('a', true)).toBeNull();
    expect(limits.take('a', true)).toContain('Opus');
    expect(limits.take('a', false)).toBeNull();
    expect(limits.take('a', false)).toBeNull();
    expect(limits.take('a', false)).toContain('3 questions');
    expect(limits.take('b', false)).toBeNull();
    now = 3_600_001;
    expect(limits.take('a', true)).toBeNull();
  });

  it('builds context from a thread: answers are the assistant, the rest are questions', () => {
    const ctx = [
      toContext({ authorId: 'bot', authorName: 'Ledger', content: 'An answer' }, 'bot'),
      toContext({ authorId: 'u1', authorName: 'Sam', content: '<@42> and Tanaris?' }, 'bot'),
      toContext({ authorId: 'u2', authorName: 'Cody', content: '' }, 'bot'),
    ];
    expect(ctx).toEqual([
      { role: 'assistant', content: 'An answer' },
      { role: 'user', content: 'Sam: and Tanaris?' },
      null,
    ]);
    expect(conversation(ctx.filter((m) => m !== null))).toEqual([
      { role: 'user', content: 'Sam: and Tanaris?' },
    ]);
  });
});

describe('asking the ledger', () => {
  it('uses Sonnet 5 with the ledger MCP server and the read token', async () => {
    const api = fakeApi([{ content: text('From the ledger: 0 clams in 40 minutes.') }]);
    const answer = await ledgerAsker(
      config,
      api.create,
    )({ messages: question, opus: false, admin: false });
    expect(answer).toMatchObject({
      text: 'From the ledger: 0 clams in 40 minutes.',
      model: DEFAULT_MODEL,
    });
    const p = api.calls[0]!;
    expect(p).toMatchObject({
      model: 'claude-sonnet-5',
      betas: ['mcp-client-2025-11-20'],
      thinking: { type: 'adaptive' },
      mcp_servers: [{ type: 'url', url: config.mcpUrl, authorization_token: 'flt_read' }],
      tools: [{ type: 'mcp_toolset', mcp_server_name: 'forever-ledger' }],
    });
    expect(JSON.stringify(p.system)).toContain("can't add to the ledger");
  });

  it('--opus uses Opus 5.5 at high effort; an admin gets the write token', async () => {
    const api = fakeApi([{ content: text('Logged.') }]);
    await ledgerAsker(config, api.create)({ messages: question, opus: true, admin: true });
    const p = api.calls[0]!;
    expect(p.model).toBe(OPUS_MODEL);
    expect(p.model).toBe('claude-opus-5-5');
    expect(p).not.toHaveProperty('thinking');
    expect(p.output_config).toEqual({ effort: 'high' });
    expect(p.mcp_servers![0]!.authorization_token).toBe('flt_admin');
    expect(JSON.stringify(p.system)).toContain('log_observation');
  });

  it('an admin without an admin token configured stays read-only', async () => {
    const api = fakeApi([{ content: text('ok') }]);
    await ledgerAsker(
      { ...config, adminToken: undefined },
      api.create,
    )({
      messages: question,
      opus: false,
      admin: true,
    });
    expect(api.calls[0]!.mcp_servers![0]!.authorization_token).toBe('flt_read');
  });

  it('continues a paused turn and handles refusals and cut-offs', async () => {
    const paused = fakeApi([
      { content: text('Looking… '), stop_reason: 'pause_turn' },
      { content: text('Done.'), stop_reason: 'end_turn' },
    ]);
    const a = await ledgerAsker(
      config,
      paused.create,
    )({ messages: question, opus: false, admin: false });
    expect(paused.calls).toHaveLength(2);
    expect(paused.calls[1]!.messages.at(-1)).toMatchObject({ role: 'assistant' });
    expect(a.text).toBe('Done.');
    expect(a.usage).toEqual({ input: 20, output: 10, cacheRead: 0 });

    const refused = fakeApi([{ content: [], stop_reason: 'refusal' }]);
    expect(
      (await ledgerAsker(config, refused.create)({ messages: question, opus: false, admin: false }))
        .text,
    ).toBe("I can't help with that one.");
    const long = fakeApi([{ content: text('Part'), stop_reason: 'max_tokens' }]);
    expect(
      (await ledgerAsker(config, long.create)({ messages: question, opus: false, admin: false }))
        .text,
    ).toContain('cut off');
  });
});
