// The MCP tools (project-plans/forever-ledger-mcp-server.md). Each answers only from the ledger through
// @forever-ledger/server's knowledge answers; this file only describes the tools and formats their answers. Write tools
// are registered only for an admin-owned token.
import {
  addManualClaim,
  checkClaim,
  createGuide,
  fishingAnswer,
  GuideError,
  gearUpgrades,
  importSeed,
  levelingRoute,
  lookupCharacter,
  lookupItem,
  lookupNpc,
  lookupQuest,
  lookupZone,
  ManualClaimError,
  searchEntities,
  whereToGet,
  withWowheadLinks,
} from '@forever-ledger/server';
import type { Db } from '@forever-ledger/server';
import { CLAIM_LABELS, ENTITY_TYPES } from '@forever-ledger/contracts';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';

export const SERVER_NAME = 'forever-ledger';
export const SERVER_VERSION = '0.1.0';

/** What every client is told up front: the contract the answers keep, and the one it must keep too. */
export const INSTRUCTIONS = `Forever Ledger answers questions about World of Warcraft: Forever (the 2026 beta, launch Nov 4 2026) only from its own database.
Every answer has:
- firstParty: what our own players' addon uploads observed (tier 1, the strongest evidence; counts and rates are real).
- facts: claims from sources, best first. Each has a label (VERIFIED = Forever data, CLASSIC = Classic-era data that Forever may change, ANECDOTE = a player's report, UNVERIFIED = unconfirmed), a tier (1 best … 7 worst), the source URL and the build.
- gaps: what the ledger does not know.
send_guide turns a leveling route into an in-game guide and sends it to the character's tray: use it when someone asks to send, push or load a guide to a character.
Items, NPCs, quests and objects carry their Wowhead Forever page as itemUrl / npcUrl / questUrl / containerUrl / objectUrl, or url on an { type, id } entity: link names with those, never with a URL you make up.
Leveling questions ("quickest way to 13 as an undead") are answered by leveling_route: the quests our own players turned in, in order, with time taken. Players' own characters (by full name, e.g. "Sam Willikers") are in lookup_character and gear_upgrades; gear upgrade scores are estimates (Forever has no spec data), and a role the asker didn't name is a guess: say so.
Answer from these only. Say which label each statement rests on, prefer first-party data and lower tiers, and say plainly when the ledger has a gap instead of filling it from memory. FALSE claims are never facts: check_claim lists them as refuted.`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
/** Postgres int4: a bigger number would fail in the database (and its error text must never reach a client). */
const INT4_MAX = 2_147_483_647;
const build = z.number().int().positive().max(INT4_MAX);
const gameId = z.number().int().nonnegative().max(INT4_MAX);
const ref = z.string().trim().min(1).max(200);

/**
 * One text block holding the answer as JSON (what every client reads), plus the same as structured content. Every
 * item, NPC, quest and object in it carries its Wowhead Forever link (`itemUrl`, `npcUrl`, `questUrl`, … or `url`).
 */
function reply(raw: unknown): CallToolResult {
  const answer = withWowheadLinks(raw);
  return {
    content: [{ type: 'text', text: JSON.stringify(answer) }],
    structuredContent: answer as Record<string, unknown>,
  };
}

const failure = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * Runs a tool; an unexpected failure (a database error carries its SQL and parameters) is logged here and the client
 * gets a plain message instead.
 */
const guarded =
  <A>(deps: ToolDeps, tool: string, fn: (args: A) => Promise<CallToolResult>) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      deps.onError?.(tool, err);
      return failure('the ledger could not answer that right now');
    }
  };

export interface ToolDeps {
  db: Db;
  /** The token's owner is an admin: the write tools are offered. */
  canWrite: boolean;
  /** Who called (token label), for the observation and claim notes. */
  caller: string;
  /** Unexpected tool failures (logged by the HTTP layer, never sent to the client). */
  onError?: (tool: string, err: unknown) => void;
}

export function buildServer(deps: ToolDeps): McpServer {
  const { db } = deps;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  );

  server.registerTool(
    'search',
    {
      title: 'Search the ledger',
      description:
        'Find items, quests, NPCs, zones and dungeons by part of their name or by id. Use it to get the id before a lookup.',
      inputSchema: z.object({
        query: ref.describe('Part of a name, or a game id'),
        type: z.enum(ENTITY_TYPES).optional().describe('Only this kind of entity'),
      }),
      annotations: READ_ONLY,
    },
    guarded(
      deps,
      'search',
      async ({ query, type }: { query: string; type?: (typeof ENTITY_TYPES)[number] }) => {
        const hits = await searchEntities(db, query, type);
        return reply({
          query,
          hits,
          gaps: hits.length === 0 ? [`the ledger has nothing named like "${query}"`] : [],
        });
      },
    ),
  );

  const lookup = (
    name: string,
    title: string,
    description: string,
    what: string,
    fn: (db: Db, ref: string) => Promise<unknown>,
  ) =>
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: z.object({ [what]: ref.describe(`The ${what}'s id or name`) }),
        annotations: READ_ONLY,
      },
      guarded(deps, name, async (args: Record<string, string>) => reply(await fn(db, args[what]!))),
    );

  lookup(
    'lookup_item',
    'Look up an item',
    'Everything the ledger knows about an item: its stats, where our players got it (drops per kill, nodes, containers, fishing, quests, vendors), and labeled claims from sources.',
    'item',
    lookupItem,
  );
  lookup(
    'where_to_get',
    'Where to get an item',
    'How to get an item: our own observed rates first (drops per kill, fishing catches per cast, field sessions such as "0 clams in 40 minutes"), then source claims ranked by trust. Use this for farming questions.',
    'item',
    whereToGet,
  );
  lookup(
    'lookup_quest',
    'Look up a quest',
    'A quest: level, giver and location, rewards and XP our players saw, and labeled claims (level, required level, XP, money, reputation).',
    'quest',
    lookupQuest,
  );
  lookup(
    'lookup_npc',
    'Look up an NPC',
    'An NPC: vendor and trainer details, quests it gives, what our players saw it drop per kill, and labeled claims (level range, zones, drops, sells).',
    'npc',
    lookupNpc,
  );
  lookup(
    'lookup_zone',
    'Look up a zone',
    'A zone or dungeon: level range and other labeled claims, what our players fished there and the gathering nodes they found.',
    'zone',
    lookupZone,
  );

  server.registerTool(
    'lookup_character',
    {
      title: "Look up a player's character",
      description:
        'One of our players\' characters, by full name ("Sam Willikers") or first name: class, race, level, professions, quests turned in and what they wear (recorded by addon 0.5.0 at login).',
      inputSchema: z.object({ character: ref.describe('Full name, first name, or Name-Realm') }),
      annotations: READ_ONLY,
    },
    guarded(deps, 'lookup_character', async ({ character }: { character: string }) =>
      reply(await lookupCharacter(db, character)),
    ),
  );

  server.registerTool(
    'leveling_route',
    {
      title: 'Leveling route',
      description:
        'A step-by-step leveling guide built from how our own players leveled: the fastest recorded run of that race (or zone, or character) to the level, as steps in the order it was played: accept (NPC, subzone, coordinates, quests), complete (each quest\'s objectives) and turn in (NPC, coordinates, XP, level after). Pass forCharacter (the asker\'s character) to start at their level and leave out quests they already did. Also gives level-up times, play time, other characters\' progress and the quests seen in that zone. Use it for any "how do I level", "quickest way to N", "leveling guide" or "what quests are in <zone>" question.',
      inputSchema: z.object({
        start: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .optional()
          .describe(
            'A race (undead, orc, troll, tauren, human, dwarf, gnome, night elf) or a zone name',
          ),
        character: ref.optional().describe("One of our players' characters, to follow their route"),
        forCharacter: ref
          .optional()
          .describe("The asker's own character: start at their level, skip quests they've done"),
        toLevel: z.number().int().min(2).max(60).describe('The level to reach'),
        fromLevel: z
          .number()
          .int()
          .min(1)
          .max(59)
          .optional()
          .describe('Where the route starts (default 1)'),
      }),
      annotations: READ_ONLY,
    },
    guarded(
      deps,
      'leveling_route',
      async (args: {
        start?: string;
        character?: string;
        forCharacter?: string;
        toLevel: number;
        fromLevel?: number;
      }) => reply(await levelingRoute(db, args)),
    ),
  );

  server.registerTool(
    'gear_upgrades',
    {
      title: "A character's gear upgrades",
      description:
        'Gear upgrades for one of our players\' characters: per slot, items the ledger knows that their class can wear at (or up to 3 levels above) their level and that score higher for the role than what they wear, each with where to get it (our drops, quest rewards and vendors first, then source claims). Scores are an estimate. Pass the role when the asker names one ("as a tank"); otherwise it is guessed from their gear. Crafted items are listed only when the character has the profession; set includeCrafted when the asker wants crafted gear someone else could make.',
      inputSchema: z.object({
        character: ref.describe('Full name, first name, or Name-Realm'),
        role: z.enum(['tank', 'healer', 'caster', 'melee', 'ranged']).optional(),
        includeCrafted: z
          .boolean()
          .optional()
          .describe("Also list crafted items from professions the character doesn't have"),
      }),
      annotations: READ_ONLY,
    },
    guarded(
      deps,
      'gear_upgrades',
      async ({
        character,
        role,
        includeCrafted,
      }: {
        character: string;
        role?: 'tank' | 'healer' | 'caster' | 'melee' | 'ranged';
        includeCrafted?: boolean;
      }) => reply(await gearUpgrades(db, character, role, { includeCrafted })),
    ),
  );

  server.registerTool(
    'fishing_yield',
    {
      title: 'Fishing yield',
      description:
        'Our own fishing casts: catches per cast by zone and subzone, or where one item was caught. Filters narrow by zone, subzone, build, lure and effective skill.',
      inputSchema: z.object({
        item: ref.optional().describe('An item id or name: where it was caught, per cast'),
        zone: z.string().max(128).optional(),
        subzone: z.string().max(128).optional(),
        build: build.optional(),
        lure: z.enum(['yes', 'no']).optional(),
        minSkill: z.number().int().min(0).max(1000).optional(),
      }),
      annotations: READ_ONLY,
    },
    guarded(deps, 'fishing_yield', async (args: Parameters<typeof fishingAnswer>[1]) =>
      reply(await fishingAnswer(db, args)),
    ),
  );

  server.registerTool(
    'check_claim',
    {
      title: 'Check a claim',
      description:
        'Check a statement (from a guide, a friend or another AI) against the ledger: the claims for and against it, those already refuted (FALSE), and disputes between sources. Name the entity when you know it.',
      inputSchema: z.object({
        statement: z.string().trim().min(3).max(500),
        entityType: z.enum(ENTITY_TYPES).optional(),
        entity: ref.optional().describe('The id or name the statement is about'),
      }),
      annotations: READ_ONLY,
    },
    guarded(
      deps,
      'check_claim',
      async ({
        statement,
        entityType,
        entity,
      }: {
        statement: string;
        entityType?: (typeof ENTITY_TYPES)[number];
        entity?: string;
      }) =>
        reply(
          await checkClaim(
            db,
            statement,
            entityType && entity ? { type: entityType, ref: entity } : undefined,
          ),
        ),
    ),
  );

  server.registerTool(
    'send_guide',
    {
      title: "Send an in-game guide to a player's character",
      description:
        'Build a Zygor-style in-game guide from one of our players\' real runs (the leveling_route data) for a character, and send it to the Forever Ledger tray that uploads that character. The player sees it after their tray picks it up (within about 5 minutes) and they /reload; /fl guide shows it. Give start (a race like "undead" or a zone) or basedOn (whose run to follow), and toLevel. Quests the character already turned in are left out.',
      inputSchema: z.object({
        character: ref.describe('The character it is for: full name, first name, or Name-Realm'),
        start: z.string().trim().min(1).max(64).optional().describe('A race or a starting zone'),
        basedOn: ref.optional().describe("Follow this character's run"),
        toLevel: z.number().int().min(2).max(60),
        fromLevel: z.number().int().min(1).max(60).optional(),
        requestedBy: z
          .string()
          .regex(/^discord:\d{1,32}$/)
          .optional()
          .describe(
            'Who asked, when relayed for someone (the Discord bot passes "discord:<user id>")',
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded(
      deps,
      'send_guide',
      async (args: {
        character: string;
        start?: string;
        basedOn?: string;
        toLevel: number;
        fromLevel?: number;
        requestedBy?: string;
      }) => {
        try {
          // The token is who answers for it; a relayed asker is recorded with it (and limited on its own).
          const { requestedBy, ...rest } = args;
          const { doc: _doc, ...made } = await createGuide(db, {
            ...rest,
            requestedBy: requestedBy ? `${requestedBy} via ${deps.caller}` : `mcp:${deps.caller}`,
          });
          return reply({
            ...made,
            delivery:
              "the character's tray picks it up within about 5 minutes; then /reload in game and /fl guide shows it",
          });
        } catch (err) {
          if (err instanceof GuideError) return failure(`no guide sent: ${err.message}`);
          throw err;
        }
      },
    ),
  );

  if (!deps.canWrite) return server;

  server.registerTool(
    'log_observation',
    {
      title: 'Log a field observation',
      description:
        'Record something a player saw in game (a farming session, a drop, a rate) as first-party, tier 1 evidence, with the claims it supports. Only for things a player actually did and reported; never for things read elsewhere.',
      inputSchema: z.object({
        character: z.string().max(128).optional(),
        level: z.number().int().min(1).max(80).optional(),
        build: build.optional(),
        observedAt: z.iso.datetime({ offset: true }).describe('When, with a UTC offset'),
        durationMins: z.number().int().positive().optional(),
        location: z
          .object({ zone: z.string().max(128), subzone: z.string().max(128).optional() })
          .optional(),
        method: z.string().min(1).max(64).describe('fishing, farming, questing, …'),
        setup: z.record(z.string(), z.json()).optional().describe('Gear, lure, skill, group'),
        result: z.record(z.string(), z.json()).describe('What happened, with counts'),
        notes: z.string().max(4000).optional(),
        claims: z
          .array(
            z.object({
              entityType: z.enum(ENTITY_TYPES),
              entityId: gameId.optional(),
              entityName: z.string().min(1).max(200).optional(),
              attribute: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
              value: z.json(),
            }),
          )
          .max(20)
          .default([]),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      // observedAt (not the logging time) plus a random part: two sessions never share a key, so neither overwrites
      // the other (importSeed upserts by key).
      const slug = `${args.method}-${args.location?.zone ?? 'somewhere'}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40);
      const when = new Date(args.observedAt).toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const key = `mcp-${when}-${slug}-${randomUUID().slice(0, 8)}`;
      const notes = [args.notes, `logged through MCP by ${deps.caller}`].filter(Boolean).join('\n');
      try {
        const res = await importSeed(db, {
          observations: [{ ...args, key, gameVersion: 'forever', notes }],
        });
        return reply({ key, claimsAdded: res.claims });
      } catch (err) {
        // A ZodError names what's wrong with the input; anything else is the database's business.
        if (err instanceof z.ZodError) return failure(`not logged: ${z.prettifyError(err)}`);
        deps.onError?.('log_observation', err);
        return failure('not logged: the ledger could not store it');
      }
    },
  );

  server.registerTool(
    'add_claim',
    {
      title: 'Add a claim from a fetched page',
      description:
        'Add a claim read off a page the ledger has fetched. The quote must appear on the stored page, or it is refused. Use search/lookups first to avoid duplicates.',
      inputSchema: z.object({
        source: z
          .string()
          .min(1)
          .max(2048)
          .describe('The fetched page URL, or a source key such as snapshot:12'),
        entityType: z.enum(ENTITY_TYPES),
        entityId: gameId.optional(),
        entityName: z.string().min(1).max(200).optional(),
        attribute: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        value: z.json(),
        quote: z.string().min(1).max(2000),
        label: z.enum(CLAIM_LABELS).optional(),
        observedBuild: build.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const added = await addManualClaim(db, {
          ...args,
          note: `added through MCP by ${deps.caller}`,
        });
        return reply({ added, note: added === 0 ? 'that claim already exists' : undefined });
      } catch (err) {
        if (err instanceof ManualClaimError) return failure(`not added: ${err.message}`);
        deps.onError?.('add_claim', err);
        return failure('not added: the ledger could not store it');
      }
    },
  );

  return server;
}
