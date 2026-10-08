// Characters and their gear upgrades for the MCP server (project-plans/forever-ledger-gear-upgrades.md). A character
// is what our uploads saw (class, race, level, professions, gear from addon 0.5.0 / schema 8). Upgrades compare each
// worn item with the items the ledger has stats for, scored for a role by contracts' gear weights: an estimate
// (Forever has no spec data), and every answer says so. Each suggestion says where to get it, from our own data first.
// Crafted items need the profession: ones the character can't make are left out unless asked for.
import {
  canEquip,
  CLASS_ROLES,
  canDualWield,
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

/** Classic profession skill lines, to name a profession no character in the ledger has. */
const PROFESSION_NAMES: Record<number, string> = {
  129: 'First Aid',
  164: 'Blacksmithing',
  165: 'Leatherworking',
  171: 'Alchemy',
  185: 'Cooking',
  197: 'Tailoring',
  202: 'Engineering',
  333: 'Enchanting',
};

interface CharacterRow {
  key: string;
  name: string;
  realm: string;
  class: string | null;
  race: string | null;
  faction: string | null;
  level: number | null;
  last_seen: Date | null;
  first_name: string | null;
}

/** Characters whose full name, first name or key matches (exact name first). */
export async function findCharacters(db: Db, ref: string): Promise<CharacterRow[]> {
  const q = ref.trim();
  if (!q) return [];
  return rows<CharacterRow>(
    db,
    sql`select key, name, realm, class, race, faction, level, last_seen, first_name from characters
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
  const want = ref.trim().toLowerCase();
  // An exact full name, else an exact first name ("Sam" is Sam Willikers, not also Samuel).
  const exactName = found.filter((c) => c.name.toLowerCase() === want);
  const exact =
    exactName.length > 0 ? exactName : found.filter((c) => c.first_name?.toLowerCase() === want);
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

interface Crafted {
  /** Skill lines of the professions that make it; empty when a spell makes it but its profession is unknown. */
  skillLineIds: number[];
  recipeIds: number[];
}

/**
 * Which of these items a profession makes: from recipes our players scanned (the recipe's output), then from Wowhead's
 * "created by" spells, named through our recipes (a recipe id is its spell id) or the row's own skill line.
 */
async function craftedItems(db: Db, itemIds: number[]): Promise<Map<number, Crafted>> {
  const out = new Map<number, Crafted>();
  if (itemIds.length === 0) return out;
  const ids = sql.join(
    itemIds.map((i) => sql`${i}`),
    sql`, `,
  );
  const found = await rows<{
    item_id: number;
    recipe_id: number | null;
    skill_line_id: number | null;
  }>(
    db,
    sql`select s.output_item_id as item_id, r.recipe_id, r.skill_line_id
          from recipe_snapshots s join recipes r on r.recipe_id = s.recipe_id
         where s.output_item_id in (${ids})
        union
        select c.entity_id, sp.id, coalesce(r.skill_line_id, sp.skill)
          from claims c
          cross join lateral (select case when jsonb_typeof(c.value->'id') = 'number' then (c.value->>'id')::int end as id,
                                     case when jsonb_typeof(c.value->'skills'->0) = 'number'
                                          then (c.value->'skills'->>0)::int end as skill) sp
          left join recipes r on r.recipe_id = sp.id
         where c.entity_type = 'item' and c.attribute = 'created_by_spell' and c.label <> 'FALSE'
           and c.entity_id in (${ids})`,
  );
  for (const f of found) {
    const e = out.get(f.item_id) ?? { skillLineIds: [], recipeIds: [] };
    if (f.skill_line_id !== null && !e.skillLineIds.includes(f.skill_line_id))
      e.skillLineIds.push(f.skill_line_id);
    if (f.recipe_id !== null && !e.recipeIds.includes(f.recipe_id)) e.recipeIds.push(f.recipe_id);
    out.set(f.item_id, e);
  }
  return out;
}

/** A character's professions (skill line → name) and the recipes they know. */
async function craftingOf(db: Db, key: string) {
  const skills = await rows<{ skill_line_id: number; name: string }>(
    db,
    sql`select skill_line_id, name from skills where char = ${key} order by rank desc, name`,
  );
  const known = await rows<{ recipe_id: number }>(
    db,
    sql`select recipe_id from recipes_learned where char = ${key}
        union select recipe_id from recipe_status where char = ${key} and learned`,
  );
  return {
    skills: new Map(skills.map((x) => [x.skill_line_id, x.name])),
    recipes: new Set(known.map((x) => x.recipe_id)),
  };
}

/** Names for skill lines: what our characters' skills call them, else the Classic name. */
async function professionNames(db: Db, skillLineIds: number[]) {
  const names = new Map<number, string>();
  if (skillLineIds.length === 0) return names;
  const found = await rows<{ skill_line_id: number; name: string }>(
    db,
    sql`select distinct on (skill_line_id) skill_line_id, name from skills
         where skill_line_id in (${sql.join(
           skillLineIds.map((i) => sql`${i}`),
           sql`, `,
         )}) order by skill_line_id, last_seen desc`,
  );
  for (const id of skillLineIds) names.set(id, PROFESSION_NAMES[id] ?? `skill line ${id}`);
  for (const f of found) names.set(f.skill_line_id, f.name);
  return names;
}

/**
 * Upgrades for a character: per slot, the best items the ledger knows that the class can wear at (or soon after)
 * its level and that score higher for the role than what's worn. Without recorded gear every slot counts as empty,
 * so the answer is "the best items we know for that slot". Crafted items need one of the character's professions;
 * with `includeCrafted` the others are listed too, marked as made by someone else.
 */
export async function gearUpgrades(
  db: Db,
  ref: string,
  askedRole?: Role,
  opts: { includeCrafted?: boolean } = {},
) {
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
  // With a two-hander on, anything for the off hand means taking it off: it has to beat the two-hander too.
  const twoHanderOn = mainHand?.equipLoc === 'INVTYPE_2HWEAPON';
  const dualWield = canDualWield(classToken, level);
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
    // Off-hand weapons need dual wield (Classic: rogues; warriors and hunters from 20; never shamans).
    if (item.equip_loc === 'INVTYPE_WEAPON' && !dualWield) slots = [16];
    if (item.equip_loc === 'INVTYPE_WEAPONOFFHAND' && !dualWield) continue;
    if (twoHanderOn) {
      // With a two-hander on, a one-hander replaces it in the main hand; an off-hand-only item (shield, held item,
      // off-hand weapon) would need a main-hand weapon too, so it is no upgrade on its own.
      if (slots.every((x) => x === 17)) continue;
      slots = slots.filter((x) => x !== 17);
    }
    if (slots.length === 0) continue;
    const score = scoreOf(item.stats);
    if (score <= 0) continue;
    // Two slots of a kind (rings, trinkets, one-handers for dual wielders): it replaces the weaker one.
    const target = slots
      .map((slot) => ({ slot, current: scoreOf(worn.get(slot)?.stats) }))
      .sort((a, b) => a.current - b.current)[0]!;
    const current =
      item.equip_loc === 'INVTYPE_2HWEAPON' || (target.slot === 16 && twoHanderOn)
        ? handsScore
        : target.current;
    const gain = Math.round((score - current) * 10) / 10;
    if (gain < MIN_GAIN) continue;
    const list = bySlot.get(target.slot) ?? [];
    list.push({ item, score, gain, soon: req > level, slot: target.slot });
    bySlot.set(target.slot, list);
  }

  // Crafted upgrades: kept when the character has the profession (or crafted ones were asked for), else counted.
  const crafted = await craftedItems(
    db,
    [...bySlot.values()].flat().map((p) => p.item.item_id),
  );
  const crafting = await craftingOf(db, c.key);
  const names = await professionNames(db, [
    ...new Set([...crafted.values()].flatMap((x) => x.skillLineIds)),
  ]);
  const hidden = new Map<string, number>();
  const craftedView = (x: Crafted) => {
    const own = x.skillLineIds.filter((id) => crafting.skills.has(id));
    return {
      professions: x.skillLineIds.map((id) => names.get(id)!),
      byCharacter: own.length > 0,
      knowsRecipe: x.recipeIds.some((id) => crafting.recipes.has(id)),
    };
  };
  for (const [slot, list] of bySlot) {
    bySlot.set(
      slot,
      list.filter((p) => {
        const x = crafted.get(p.item.item_id);
        if (!x || opts.includeCrafted || x.skillLineIds.some((id) => crafting.skills.has(id)))
          return true;
        const why =
          x.skillLineIds.map((id) => names.get(id)!).join(' or ') || 'an unknown profession';
        hidden.set(why, (hidden.get(why) ?? 0) + 1);
        return false;
      }),
    );
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
          crafted: crafted.has(p.item.item_id) ? craftedView(crafted.get(p.item.item_id)!) : null,
          ...(await sourcesOf(db, p.item.item_id)),
        })),
      ),
    });
  }
  if (hidden.size > 0) {
    const total = [...hidden.values()].reduce((a, b) => a + b, 0);
    // Forever lists each profession twice (a base line and a "Classic" child line): name it once.
    const own = [...new Set(crafting.skills.values())];
    gaps.push(
      `left out ${total} crafted upgrade${total === 1 ? '' : 's'} ${c.name} can't make (${[
        ...hidden,
      ]
        .map(([p, n]) => `${p}: ${n}`)
        .join(
          ', ',
        )}; their professions: ${own.length > 0 ? own.join(', ') : 'none recorded'}); ask with crafted items included to see them, made by another player`,
    );
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
    professions: [...new Set(crafting.skills.values())],
    slots,
    otherMatches: r.others.map(characterView),
    gaps,
  };
}
