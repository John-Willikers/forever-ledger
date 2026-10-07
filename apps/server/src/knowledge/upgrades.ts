// Characters and their gear upgrades for the MCP server (project-plans/forever-ledger-gear-upgrades.md). A character
// is what our uploads saw (class, race, level, professions, gear from addon 0.5.0 / schema 8). Upgrades compare each
// worn item with the items the ledger has stats for, scored for a role by contracts' gear weights: an estimate
// (Forever has no spec data), and every answer says so. Each suggestion says where to get it, from our own data first.
import {
  canEquip,
  CLASS_ROLES,
  DUAL_WIELD,
  GEAR_SCORE_VERSION,
  gearScore,
  guessRole,
  SLOT_NAMES,
  SLOTS_FOR_EQUIP_LOC,
} from '@forever-ledger/contracts';
import type { ClassToken, Role } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { iso, rows } from '../routes/adminData.js';
import { containsPattern } from '../routes/shared.js';
import { claimsAbout, itemFirstParty, SOURCE_ATTRIBUTES } from './answers.js';

/** Items up to this many levels above the character are listed too, marked `soon`. */
export const SOON_LEVELS = 3;
/** Suggestions per slot. */
export const PER_SLOT = 3;
/** A candidate must beat what's worn by this many points (rounding noise is no upgrade). */
const MIN_GAIN = 1;

const CLASS_TOKENS = new Set(Object.keys(CLASS_ROLES));

interface CharacterRow {
  key: string;
  name: string;
  realm: string;
  class: string | null;
  race: string | null;
  faction: string | null;
  level: number | null;
  last_seen: Date | null;
}

/** Characters whose full name, first name or key matches (exact name first). */
export async function findCharacters(db: Db, ref: string): Promise<CharacterRow[]> {
  const q = ref.trim();
  if (!q) return [];
  return rows<CharacterRow>(
    db,
    sql`select key, name, realm, class, race, faction, level, last_seen from characters
         where lower(name) = lower(${q}) or lower(first_name) = lower(${q}) or lower(key) = lower(${q})
            or name ilike ${containsPattern(q)} escape '\\'
         order by (lower(name) = lower(${q})) desc, last_seen desc nulls last
         limit 10`,
  );
}

const characterView = (c: CharacterRow) => ({
  key: c.key,
  name: c.name,
  realm: c.realm,
  class: c.class,
  race: c.race,
  faction: c.faction,
  level: c.level,
  lastSeen: iso(c.last_seen),
});

type Resolved =
  | { character: CharacterRow; others: CharacterRow[] }
  | { character: null; gaps: string[]; matches: ReturnType<typeof characterView>[] };

async function resolveCharacter(db: Db, ref: string): Promise<Resolved> {
  const found = await findCharacters(db, ref);
  if (found.length === 0) {
    return {
      character: null,
      matches: [],
      gaps: [
        `the ledger has no character named "${ref}" (characters appear once their tray uploads)`,
      ],
    };
  }
  const exact = found.filter((c) => c.name.toLowerCase() === ref.trim().toLowerCase());
  if (exact.length === 1 || found.length === 1) {
    const character = exact[0] ?? found[0]!;
    return { character, others: found.filter((c) => c.key !== character.key) };
  }
  return {
    character: null,
    matches: found.map(characterView),
    gaps: [`several characters match "${ref}": ask again with the full name`],
  };
}

interface WornSlot {
  slot: number;
  itemId: number;
  link?: string;
  stats?: Record<string, number>;
}

/** The newest gear read for a character (schema 8), with item names and, where the read had none, stored stats. */
async function wornGear(db: Db, key: string) {
  const [row] = await rows<{ build: number; seen_at: Date; slots: WornSlot[] }>(
    db,
    sql`select build, seen_at, slots from character_gear where char = ${key}
         order by build desc, seen_at desc limit 1`,
  );
  if (!row) return null;
  const ids = row.slots.map((s) => s.itemId);
  const items =
    ids.length === 0
      ? []
      : await rows<{
          item_id: number;
          name: string;
          quality: number | null;
          equip_loc: string | null;
          stats: Record<string, number> | null;
        }>(
          db,
          sql`select i.item_id, i.name, i.quality, i.equip_loc, s.stats
                from items i left join lateral (select stats from item_snapshots s where s.item_id = i.item_id
                                                 order by build desc limit 1) s on true
               where i.item_id in (${sql.join(
                 ids.map((i) => sql`${i}`),
                 sql`, `,
               )})`,
        );
  const byId = new Map(items.map((i) => [i.item_id, i]));
  return {
    build: row.build,
    seenAt: iso(row.seen_at),
    slots: row.slots
      .map((s) => {
        const it = byId.get(s.itemId);
        return {
          slot: s.slot,
          slotName: SLOT_NAMES[s.slot] ?? `Slot ${s.slot}`,
          itemId: s.itemId,
          name: it?.name ?? null,
          quality: it?.quality ?? null,
          equipLoc: it?.equip_loc ?? null,
          // The worn copy's own stats (random suffix included) beat the item's base stats.
          stats: s.stats ?? it?.stats ?? undefined,
        };
      })
      .sort((a, b) => a.slot - b.slot),
  };
}

/** A character: who they are, their professions and what they wear. */
export async function lookupCharacter(db: Db, ref: string) {
  const r = await resolveCharacter(db, ref);
  if (!r.character) return { query: ref, character: null, matches: r.matches, gaps: r.gaps };
  const c = r.character;
  const professions = await rows<{ name: string; rank: number; max_rank: number | null }>(
    db,
    sql`select name, max(rank)::int as rank, max(max_rank)::int as max_rank from skills
         where char = ${c.key} and name is not null group by name order by rank desc, name`,
  );
  const [activity] = await rows<{ turn_ins: number; last_turn_in: Date | null }>(
    db,
    sql`select count(*)::int as turn_ins, max(turned_in_at) as last_turn_in from turn_ins
         where char = ${c.key}`,
  );
  const gear = await wornGear(db, c.key);
  const gaps: string[] = [];
  if (!gear) {
    gaps.push(
      'no gear recorded yet: addon 0.5.0 records it at the next login (an older addon never did)',
    );
  }
  return {
    query: ref,
    character: characterView(c),
    professions: professions.map((p) => ({ name: p.name, rank: p.rank, max: p.max_rank })),
    activity: {
      questsTurnedIn: activity?.turn_ins ?? 0,
      lastTurnIn: iso(activity?.last_turn_in ?? null),
    },
    gear: gear && {
      build: gear.build,
      seenAt: gear.seenAt,
      slots: gear.slots.map(({ stats, ...s }) => ({ ...s, stats: stats ?? null })),
    },
    otherMatches: r.others.map(characterView),
    gaps,
  };
}

interface Candidate {
  item_id: number;
  name: string;
  quality: number | null;
  type: string | null;
  subtype: string | null;
  equip_loc: string;
  req_level: number | null;
  ilvl: number | null;
  stats: Record<string, number> | null;
}

/** Where to get an item, in short: our own sightings first, then the best source claims. */
async function sourcesOf(db: Db, itemId: number) {
  const seen = await itemFirstParty(db, itemId);
  const { facts } = await claimsAbout(db, [{ type: 'item', keys: [String(itemId)] }], {
    attributes: SOURCE_ATTRIBUTES,
    perAttribute: 2,
  });
  return {
    firstParty: {
      drops: seen.drops.slice(0, 3),
      questRewards: seen.questRewards.slice(0, 3),
      vendors: seen.vendors.slice(0, 2).map(({ loc: _loc, ...v }) => v),
      containers: seen.containers.slice(0, 2),
      nodes: seen.nodes.slice(0, 2),
      fishing: seen.fishing.slice(0, 2),
    },
    claims: facts.slice(0, 4).map((f) => ({
      attribute: f.attribute,
      value: f.value,
      label: f.label,
      tier: f.tier,
      url: f.source.url,
    })),
  };
}

/**
 * Upgrades for a character: per slot, the best items the ledger knows that the class can wear at (or soon after)
 * its level and that score higher for the role than what's worn. Without recorded gear every slot counts as empty,
 * so the answer is "the best items we know for that slot".
 */
export async function gearUpgrades(db: Db, ref: string, askedRole?: Role) {
  const r = await resolveCharacter(db, ref);
  if (!r.character) return { query: ref, character: null, matches: r.matches, gaps: r.gaps };
  const c = r.character;
  const gaps: string[] = [];
  const cls = (c.class ?? '').toUpperCase();
  if (!CLASS_TOKENS.has(cls)) {
    return {
      query: ref,
      character: characterView(c),
      gaps: [`the ledger doesn't know ${c.name}'s class, so it can't tell what they can wear`],
    };
  }
  const classToken = cls as ClassToken;
  const level = c.level ?? 1;
  const gear = await wornGear(db, c.key);
  if (!gear) {
    gaps.push(
      `no gear recorded for ${c.name} yet (addon 0.5.0 records it at the next login): these are the best items the ledger knows per slot, not upgrades over what they wear`,
    );
  }
  const roleChoice =
    askedRole && CLASS_ROLES[classToken].includes(askedRole)
      ? { role: askedRole, guessed: false as const, basis: 'asked' as const }
      : guessRole(
          classToken,
          (gear?.slots ?? []).map((s) => s.stats),
        );
  if (askedRole && !CLASS_ROLES[classToken].includes(askedRole)) {
    gaps.push(`a ${classToken.toLowerCase()} can't play ${askedRole}; using ${roleChoice.role}`);
  }
  const role = roleChoice.role;

  const candidates = await rows<Candidate>(
    db,
    sql`select distinct on (i.item_id) i.item_id, i.name, i.quality, i.type, i.subtype, i.equip_loc,
               s.req_level, s.ilvl, s.stats
          from items i join item_snapshots s on s.item_id = i.item_id
         where i.equip_loc is not null and i.equip_loc not in ('', 'INVTYPE_BODY', 'INVTYPE_TABARD', 'INVTYPE_BAG')
           and coalesce(s.req_level, 0) <= ${level + SOON_LEVELS}
         order by i.item_id, s.build desc`,
  );

  const worn = new Map((gear?.slots ?? []).map((s) => [s.slot, s]));
  const scoreOf = (stats: Record<string, number> | null | undefined) =>
    gearScore(stats ?? {}, role);
  const mainHand = worn.get(16);
  const offHand = worn.get(17);
  // A two-hander replaces both hands, so it has to beat both together.
  const handsScore = scoreOf(mainHand?.stats) + scoreOf(offHand?.stats);

  type Pick = { item: Candidate; score: number; gain: number; soon: boolean; slot: number };
  const bySlot = new Map<number, Pick[]>();
  const wornIds = new Set((gear?.slots ?? []).map((s) => s.itemId));
  for (const item of candidates) {
    if (wornIds.has(item.item_id)) continue;
    const req = item.req_level ?? 0;
    // Proficiency at the level the item is usable (Mail for a Shaman only from 40).
    if (
      !canEquip(
        classToken,
        {
          type: item.type ?? undefined,
          subtype: item.subtype ?? undefined,
          equipLoc: item.equip_loc,
        },
        Math.max(level, req),
      )
    )
      continue;
    let slots = SLOTS_FOR_EQUIP_LOC[item.equip_loc] ?? [];
    if (item.equip_loc === 'INVTYPE_WEAPON' && !DUAL_WIELD.has(classToken)) slots = [16];
    if (slots.length === 0) continue;
    const score = scoreOf(item.stats);
    if (score <= 0) continue;
    // Two slots of a kind (rings, trinkets, one-handers for dual wielders): it replaces the weaker one.
    const target = slots
      .map((slot) => ({ slot, current: scoreOf(worn.get(slot)?.stats) }))
      .sort((a, b) => a.current - b.current)[0]!;
    const current = item.equip_loc === 'INVTYPE_2HWEAPON' ? handsScore : target.current;
    const gain = Math.round((score - current) * 10) / 10;
    if (gain < MIN_GAIN) continue;
    const list = bySlot.get(target.slot) ?? [];
    list.push({ item, score, gain, soon: req > level, slot: target.slot });
    bySlot.set(target.slot, list);
  }

  const slots = [];
  for (const slot of Object.keys(SLOT_NAMES).map(Number)) {
    if (slot === 4 || slot === 19) continue; // shirt and tabard carry no stats worth comparing
    const picks = (bySlot.get(slot) ?? [])
      .sort((a, b) => Number(a.soon) - Number(b.soon) || b.gain - a.gain)
      .slice(0, PER_SLOT);
    const w = worn.get(slot);
    if (picks.length === 0 && !w) continue;
    slots.push({
      slot,
      slotName: SLOT_NAMES[slot],
      equipped: w ? { itemId: w.itemId, name: w.name, score: scoreOf(w.stats) } : null,
      upgrades: await Promise.all(
        picks.map(async (p) => ({
          itemId: p.item.item_id,
          name: p.item.name,
          quality: p.item.quality,
          reqLevel: p.item.req_level,
          soon: p.soon,
          score: p.score,
          gain: p.gain,
          ...(await sourcesOf(db, p.item.item_id)),
        })),
      ),
    });
  }
  if (slots.every((s) => s.upgrades.length === 0)) {
    gaps.push('no upgrades among the items the ledger has stats for');
  }
  gaps.push(
    'only items the ledger has seen with stats (looted, rewarded or sold to one of our players) are compared',
  );
  return {
    query: ref,
    character: characterView(c),
    role: { ...roleChoice, rolesForClass: CLASS_ROLES[classToken] },
    estimate: {
      scoreVersion: GEAR_SCORE_VERSION,
      note: 'scores are stats weighted by a Classic-era rule of thumb for the role: an estimate, Forever has no spec data',
    },
    gear: gear && { build: gear.build, seenAt: gear.seenAt },
    slots,
    otherMatches: r.others.map(characterView),
    gaps,
  };
}
