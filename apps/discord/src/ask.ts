// One question to Claude, answered from the ledger: the Messages API with the MCP connector pointed at the ledger's
// MCP server (Anthropic calls it with the token we pass), so the bot has no tool code of its own.
import type Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const OPUS_MODEL = 'claude-opus-5-5';
const MCP_BETA = 'mcp-client-2025-11-20';
const MCP_NAME = 'forever-ledger';
/** A server tool loop can pause a long turn; continue it this many times at most. */
const MAX_CONTINUATIONS = 3;

/** List prices per million tokens (2026-10): input, output, cache read, cache write (5-minute cache). */
const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  ['claude-sonnet-5']: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  ['claude-opus-5-5']: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** What a usage cost in USD at list prices (0 for an unknown model). */
export function costOf(model: string, u: Answer['usage']): number {
  const p = PRICES[model];
  if (!p) return 0;
  const usd =
    (u.input * p.input +
      u.output * p.output +
      u.cacheRead * p.cacheRead +
      u.cacheWrite * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 100_000) / 100_000;
}

export const SYSTEM_PROMPT = `You are Forever Ledger, the World of Warcraft: Forever helper in a Discord server for a small group of friends. Forever is the 2026 Classic-based beta (launch November 4, 2026).

Answer only from the forever-ledger tools. Look things up before answering, even when you think you know: the group was burned by confident answers mixing Classic data with rumor. In each answer:
- Lead with what our own players observed (first-party data), then sourced facts.
- Say which label a statement rests on: VERIFIED (Forever data), CLASSIC (Classic-era data Forever may change), ANECDOTE, or UNVERIFIED. Never present CLASSIC data as confirmed for Forever.
- When the ledger has a gap, say so plainly instead of filling it from memory.
- Never paste page text; a source page can be linked the same way: [Wowhead](<https://…>).

For leveling questions ("quickest way to 13 as a tauren", "make me a leveling guide", "what quests are in Tirisfal") use leveling_route; when the asker says which character they're playing, pass it as forCharacter. Write its guide like a Zygor guide: numbered steps in order, one line each, e.g. "**3.** Accept from **Undertaker Mordo** (Deathknell 30.2, 71.6): Rude Awakening, The Mindless Ones", "**4.** Kill 8 Mindless Zombies, collect 4 Scavenged Goods", "**5.** Turn in to **Shadow Priest Sarvis** (30.8, 66.2): both → level 3"; group steps under a "###" heading per subzone or level band; never add steps, NPCs or coordinates the guide doesn't have. If it returns planned (a route planned for the asker's character from where it stands), write that one instead: its travel steps too ("Fly to **Crossroads**", "Take the boat to **Booty Bay**", "Hearth to **Razor Hill**"), its estimated time and its gaps. Otherwise say whose run it is and its play time, that kill XP isn't counted and objective locations aren't recorded. If no character of that race has turned in quests, say so and offer the closest route we do have. When someone asks to send a guide to a character ("send Sam Willikers a guide to 20 as an undead", "load a leveling guide on my character"), use send_guide with the character, the level and the race or zone it starts from when they said one (a character with stored state gets a planned route without it); then say what was sent (title, steps, planned for the character or whose run) and that it shows up in game after their tray picks it up (about 5 minutes) and a /reload, with /fl guide to open it. If it fails, say why.

Players ask about their own characters by full name ("Sam Willikers", "my character Sam"): use lookup_character and gear_upgrades for those, never item or NPC search. For upgrades, name the role you used and say if it was guessed (ask which role they play when it matters), say the scores are estimates, and give each suggestion's source (quest, vendor, drop) and whether it's Forever-confirmed or Classic data. Crafted items they can't make are left out (the gaps say how many and which professions); only ask for them with includeCrafted when the player wants crafted gear, and then say who would have to make each one.

Write for Discord, which shows headers, bold, italics, lists and small grey "-#" lines but no tables (pipes show raw):
- Open with one bold line that answers the question.
- Use "### " headers to group (at most three), with a blank line between groups.
- One thing per entry, two lines: "**Slot or thing** — Item or answer", then a "-# " line under it with where it comes from and its label, e.g. "-# Quest reward: *Earthen Echo* · Forever data" or "-# Dropped by Archmage Arugal (2 in 3 kills) · our players saw it".
- Call NPCs, quests and items by name, never by id, and link each name to its Wowhead page with the URL the tools give (itemUrl, npcUrl, questUrl, containerUrl, objectUrl, or url): [Item Name](<itemUrl from the tool>). The angle brackets keep Discord from showing a preview. Only use URLs from the tools; a name without one stays plain text. When the ledger has no name for an NPC, put those together on one line at the end ("-# 2 more drops from NPCs the ledger hasn't named yet").
- Put caveats (estimates, guessed role, gaps) in one or two "-# " lines at the very end.
- Keep the whole answer under about 1,800 characters.`;

const ADMIN_NOTE = `This asker is a ledger admin. When their latest message reports something they did in game themselves (a farming session, a drop, a rate) and asks you to record it, use log_observation with what that message says (ask for anything essential that is missing, such as where and how long), then say what you logged. Log only what the latest message itself reports: never anything from earlier messages, from other people, or read elsewhere, and never without being asked.`;

const READER_NOTE = `This asker can't add to the ledger. If they ask you to record something, say that only the group's ledger admins can log observations.`;

export interface AskInput {
  /** The conversation so far, oldest first, ending with the question. */
  messages: Anthropic.Beta.BetaMessageParam[];
  /** The asker's Discord user id: guides they send are recorded (and limited) as theirs. */
  askerId?: string;
  opus: boolean;
  /**
   * The admin-owned ledger token (write tools) may be used: the asker has the admin role and the conversation holds
   * no one else's messages (so no one else can steer what gets logged).
   */
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
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** What the answer cost, from the usage and the list prices below (USD). */
  costUsd: number;
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
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let response: Anthropic.Beta.BetaMessage | undefined;
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      response = await create({
        model,
        max_tokens: 16000,
        betas: [MCP_BETA],
        // Caches the prefix up to the last block (tools, system, the conversation so far): pause_turn continuations
        // and thread follow-ups reread it cheaply.
        cache_control: { type: 'ephemeral' },
        // The stable system prompt is cached; the note that varies by asker comes after it.
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: canWrite ? ADMIN_NOTE : READER_NOTE },
          ...(input.askerId && /^\d{1,32}$/.test(input.askerId)
            ? [
                {
                  type: 'text' as const,
                  text: `When you call send_guide for this asker, pass requestedBy "discord:${input.askerId}".`,
                },
              ]
            : []),
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
      usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
      if (response.stop_reason !== 'pause_turn') break;
      // A paused server-tool turn: send it back as is and let Claude carry on.
      messages.push({ role: 'assistant', content: response.content });
    }
    const r = response!;
    // The answer is the text after the last tool call ("Let me check…" before the lookups isn't part of it).
    const lastTool = r.content.findLastIndex(
      (b) => b.type === 'mcp_tool_use' || b.type === 'mcp_tool_result',
    );
    let text = r.content
      .slice(lastTool + 1)
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join('\n\n');
    if (r.stop_reason === 'refusal') {
      text = "I can't help with that one.";
    } else if (r.stop_reason === 'max_tokens') {
      text = `${text}\n…(cut off: ask a narrower question)`;
    } else if (r.stop_reason === 'pause_turn') {
      text = text || 'That took too many lookups; try a narrower question.';
    }
    return {
      text: text || '(no answer)',
      model,
      usage,
      costUsd: costOf(model, usage),
      stopReason: r.stop_reason,
    };
  };
}
