// One question to Claude, answered from the ledger: the Messages API with the MCP connector pointed at the ledger's
// MCP server (Anthropic calls it with the token we pass), so the bot has no tool code of its own.
import type Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const OPUS_MODEL = 'claude-opus-5-5';
const MCP_BETA = 'mcp-client-2025-11-20';
const MCP_NAME = 'forever-ledger';
/** A server tool loop can pause a long turn; continue it this many times at most. */
const MAX_CONTINUATIONS = 3;

export const SYSTEM_PROMPT = `You are Forever Ledger, the World of Warcraft: Forever helper in a Discord server for a small group of friends. Forever is the 2026 Classic-based beta (launch November 4, 2026).

Answer only from the forever-ledger tools. Look things up before answering, even when you think you know: the group was burned by confident answers mixing Classic data with rumor. In each answer:
- Lead with what our own players observed (first-party data), then sourced facts.
- Say which label a statement rests on: VERIFIED (Forever data), CLASSIC (Classic-era data Forever may change), ANECDOTE, or UNVERIFIED. Never present CLASSIC data as confirmed for Forever.
- When the ledger has a gap, say so plainly instead of filling it from memory.
- Link sources as <https://…> (angle brackets, so Discord shows no preview) and never paste page text.

Keep it short for Discord: a few lines or a short list, under about 1,500 characters, Discord markdown, no tables.`;

const ADMIN_NOTE = `This asker is a ledger admin. When they report something they did in game themselves (a farming session, a drop, a rate) and ask you to record it, use log_observation with what they said (ask for anything essential that is missing, such as where and how long), then say what you logged. Never log things read elsewhere, and never log without being asked.`;

const READER_NOTE = `This asker can't add to the ledger. If they ask you to record something, say that only the group's ledger admins can log observations.`;

export interface AskInput {
  /** The conversation so far, oldest first, ending with the question. */
  messages: Anthropic.Beta.BetaMessageParam[];
  opus: boolean;
  /** The asker has the admin role: the admin-owned ledger token (write tools) is used. */
  admin: boolean;
}

export interface AskConfig {
  mcpUrl: string;
  readToken: string;
  /** Without it, admins get the read token too. */
  adminToken?: string;
}

export interface Answer {
  text: string;
  model: string;
  usage: { input: number; output: number; cacheRead: number };
  stopReason: string | null;
}

type CreateFn = (
  params: Anthropic.Beta.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Beta.BetaMessage>;

export function ledgerAsker(config: AskConfig, create: CreateFn) {
  return async function ask(input: AskInput): Promise<Answer> {
    const model = input.opus ? OPUS_MODEL : DEFAULT_MODEL;
    const canWrite = input.admin && config.adminToken !== undefined;
    const messages = [...input.messages];
    const usage = { input: 0, output: 0, cacheRead: 0 };
    let response: Anthropic.Beta.BetaMessage | undefined;
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      response = await create({
        model,
        max_tokens: 16000,
        betas: [MCP_BETA],
        // The stable system prompt is cached; the note that varies by asker comes after it.
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: canWrite ? ADMIN_NOTE : READER_NOTE },
        ],
        // Sonnet 5: adaptive thinking. Opus 5.5 thinks adaptively by default (it can't be turned off); its default
        // effort is medium, so the asked-for "best answer" sets high.
        ...(input.opus
          ? { output_config: { effort: 'high' as const } }
          : { thinking: { type: 'adaptive' as const } }),
        mcp_servers: [
          {
            type: 'url',
            url: config.mcpUrl,
            name: MCP_NAME,
            authorization_token: canWrite ? config.adminToken! : config.readToken,
          },
        ],
        tools: [{ type: 'mcp_toolset', mcp_server_name: MCP_NAME }],
        messages,
      });
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      if (response.stop_reason !== 'pause_turn') break;
      // A paused server-tool turn: send it back as is and let Claude carry on.
      messages.push({ role: 'assistant', content: response.content });
    }
    const r = response!;
    let text = r.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (r.stop_reason === 'refusal') {
      text = "I can't help with that one.";
    } else if (r.stop_reason === 'max_tokens') {
      text = `${text}\n…(cut off: ask a narrower question)`;
    } else if (r.stop_reason === 'pause_turn') {
      text = text || 'That took too many lookups; try a narrower question.';
    }
    return { text: text || '(no answer)', model, usage, stopReason: r.stop_reason };
  };
}
