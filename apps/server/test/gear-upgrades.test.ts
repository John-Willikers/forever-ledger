// Schema 8 gear and the upgrade finder (project-plans/forever-ledger-gear-upgrades.md), on real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gearUpgrades, lookupCharacter } from '../src/knowledge/upgrades.js';
import { batchFromFixture, startServer } from './helpers.js';

const FULL = 'Thibodeaux Willikers-Bayou';

describe('character gear and upgrades (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = async (text: string, params: unknown[] = []) =>
    (await s.database.pool.query(text, params)).rows;
  const ingest = async (batch: object) => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    s = await startServer();
    // The schema 8 session: a hunter (the harness default) wearing a vest and an axe.
    await ingest(batchFromFixture('session-v8.lua'));
    // A level-20 hunter, so mail (40) and plate are out and req-level 18-19 items are in reach.
    await q(`update characters set level = 20 where key = $1`, [FULL]);
    // Items the ledger knows, for the upgrade finder: better leather for the slot, plate (not wearable), a better axe
    // from a quest, a ring sold by a vendor, and something above the character's level.
    await q(`insert into items (item_id, name, quality, type, subtype, equip_loc) values
      (90001, 'Bayou Jerkin', 2, 'Armor', 'Leather', 'INVTYPE_CHEST'),
      (90002, 'Iron Breastplate', 2, 'Armor', 'Plate', 'INVTYPE_CHEST'),
      (90003, 'Gator Cleaver', 3, 'Weapon', 'Two-Handed Axes', 'INVTYPE_2HWEAPON'),
      (90004, 'Swamp Ring', 2, 'Armor', 'Miscellaneous', 'INVTYPE_FINGER'),
      (90005, 'Elder Bow', 3, 'Weapon', 'Bows', 'INVTYPE_RANGED')
      on conflict do nothing`);
    await q(`insert into item_snapshots (item_id, build, req_level, ilvl, stats, tooltip) values
      (90001, 61582, 18, 22, '{"ITEM_MOD_AGILITY_SHORT": 9, "ITEM_MOD_STAMINA_SHORT": 6, "RESISTANCE0_NAME": 150}', '[]'),
      (90002, 61582, 18, 22, '{"ITEM_MOD_STRENGTH_SHORT": 20}', '[]'),
      (90003, 61582, 19, 24, '{"ITEM_MOD_AGILITY_SHORT": 12, "ITEM_MOD_DAMAGE_PER_SECOND_SHORT": 14}', '[]'),
      (90004, 61582, 15, 18, '{"ITEM_MOD_AGILITY_SHORT": 4}', '[]'),
      (90005, 61582, 30, 35, '{"ITEM_MOD_AGILITY_SHORT": 10}', '[]')`);
    await q(
      `insert into quests (quest_id, title) values (91001, 'Clear the Bayou') on conflict do nothing`,
    );
    await q(`insert into quest_reward_options (quest_id, build, item_id, kind, count)
             values (91001, 61582, 90003, 'choice', 1)`);
    await q(`insert into vendors (npc_id, build, name, items, seen_at)
             values (4444, 61582, 'Marie', '[{"itemId": 90004, "price": 900}]', now())`);
  });
  afterAll(() => s?.stop());

  it('stores what the character wears, one row per character and build', async () => {
    const rows = await q(`select char, build, slots from character_gear`);
    expect(rows).toHaveLength(1);
    expect(rows[0].char).toBe(FULL);
    const axe = rows[0].slots.find((x: { slot: number }) => x.slot === 16);
    expect(axe).toMatchObject({ itemId: 872, stats: { ITEM_MOD_STRENGTH_SHORT: 7 } });
  });

  it('an older read uploaded late never replaces a newer one', async () => {
    const old = batchFromFixture('session-v8.lua', 'ACCOUNT1', 'pc-1');
    const g = old.records.gear[0]!;
    g.at -= 3600;
    g.slots = [];
    await ingest({ ...old, meta: { ...old.meta, session: 'late' } });
    const [row] = await q(`select slots from character_gear where char = $1`, [FULL]);
    expect(row.slots.length).toBeGreaterThan(0);
    await q(`update characters set level = 20 where key = $1`, [FULL]); // the re-upload carried the old level
  });

  it('looks a character up by full or first name, with professions and gear', async () => {
    const a = await lookupCharacter(s.database.db, 'thibodeaux willikers');
    expect(a.character).toMatchObject({ key: FULL, level: 20 });
    expect(a.gear?.slots.map((x) => x.name)).toEqual(['Brown Linen Vest', 'Rockslicer']);
    expect(a.gaps).toEqual([]);
    // Part of a name finds it too ("Thibodeaux" alone is the old short-name record, an exact match).
    expect((await lookupCharacter(s.database.db, 'Willikers')).character?.key).toBe(FULL);
    expect((await lookupCharacter(s.database.db, 'Nobody')).gaps[0]).toContain(
      'no character named',
    );
  });

  it('suggests wearable upgrades with where to get them, and says it is an estimate', async () => {
    const a = await gearUpgrades(s.database.db, FULL, 'ranged');
    if (!('slots' in a) || !a.slots) throw new Error('no slots');
    expect(a.role).toMatchObject({ role: 'ranged', guessed: false });
    expect(a.estimate.note).toContain('estimate');
    const chest = a.slots.find((x) => x.slotName === 'Chest')!;
    expect(chest.equipped?.name).toBe('Brown Linen Vest');
    expect(chest.upgrades.map((u) => u.name)).toEqual(['Bayou Jerkin']); // plate is out, and mail until 40
    const hands = a.slots.find((x) => x.slotName === 'Main Hand')!;
    expect(hands.upgrades[0]).toMatchObject({ name: 'Gator Cleaver', soon: false });
    expect(hands.upgrades[0]!.firstParty.questRewards[0]).toMatchObject({
      title: 'Clear the Bayou',
    });
    const ring = a.slots.find((x) => x.slotName?.startsWith('Finger'))!;
    expect(ring.upgrades[0]!.firstParty.vendors[0]).toMatchObject({
      name: 'Marie',
      priceCopper: 900,
    });
    // Level 30 bow: more than 3 levels above, not listed.
    expect(a.slots.flatMap((x) => x.upgrades).some((u) => u.name === 'Elder Bow')).toBe(false);
  });

  it("guesses the role from the gear when none is asked, and refuses a role the class can't play", async () => {
    const guessed = await gearUpgrades(s.database.db, FULL);
    if (!('role' in guessed) || !guessed.role) throw new Error('no role');
    expect(guessed.role.guessed).toBe(true);
    const healer = await gearUpgrades(s.database.db, FULL, 'healer');
    if (!('role' in healer) || !healer.role) throw new Error('no role');
    expect(healer.role.role).toBe('ranged');
    expect(healer.gaps[0]).toContain("can't play healer");
  });

  it('never suggests an off-hand over a two-hander, and follows Classic dual wield', async () => {
    await q(`insert into characters (key, name, realm, class, level) values
      ('Brute Force-Bayou', 'Brute Force', 'Bayou', 'WARRIOR', 25),
      ('Rain Caller-Bayou', 'Rain Caller', 'Bayou', 'SHAMAN', 25)`);
    await q(`insert into items (item_id, name, quality, type, subtype, equip_loc) values
      (90006, 'Gator Shield', 2, 'Armor', 'Shields', 'INVTYPE_SHIELD'),
      (90007, 'Swamp Hatchet', 2, 'Weapon', 'One-Handed Axes', 'INVTYPE_WEAPON')`);
    await q(`insert into item_snapshots (item_id, build, req_level, ilvl, stats, tooltip) values
      (90006, 61582, 20, 24, '{"ITEM_MOD_STRENGTH_SHORT": 5}', '[]'),
      (90007, 61582, 20, 24, '{"ITEM_MOD_STRENGTH_SHORT": 4, "ITEM_MOD_DAMAGE_PER_SECOND_SHORT": 9}', '[]')`);
    // The warrior wears Rockslicer (a two-hander, Strength 7).
    await q(`insert into character_gear (char, build, seen_at, slots, uploader_id, account)
             values ('Brute Force-Bayou', 61582, now(), '[{"slot": 16, "itemId": 872}]', 'pc-1', 'A')`);
    const brute = await gearUpgrades(s.database.db, 'Brute Force', 'melee');
    if (!('slots' in brute) || !brute.slots) throw new Error('no slots');
    expect(brute.slots.find((x) => x.slot === 17)?.upgrades ?? []).toEqual([]);
    // The hatchet beats the (weak) two-hander, so it is offered for the main hand, compared with the two-hander.
    const main = brute.slots.find((x) => x.slot === 16)!;
    expect(main.upgrades.find((u) => u.name === 'Swamp Hatchet')?.gain).toBe(31 - 7);
    const shaman = await gearUpgrades(s.database.db, 'Rain Caller', 'melee');
    if (!('slots' in shaman) || !shaman.slots) throw new Error('no slots');
    // A one-hander is a main-hand option for a shaman, never an off-hand one (no dual wield in Classic).
    expect(
      shaman.slots.find((x) => x.slot === 17)?.upgrades.map((u) => u.name) ?? [],
    ).not.toContain('Swamp Hatchet');
    expect(shaman.slots.find((x) => x.slot === 16)?.upgrades.map((u) => u.name)).toContain(
      'Swamp Hatchet',
    );
  });

  it("leaves out crafted items from professions the character doesn't have, unless asked", async () => {
    await q(`insert into characters (key, name, realm, class, level) values
      ('Stitch Less-Bayou', 'Stitch Less', 'Bayou', 'HUNTER', 20)`);
    await q(`insert into skills (char, skill_line_id, name, rank, max_rank, last_seen) values
      ('Stitch Less-Bayou', 165, 'Leatherworking', 90, 150, now())`);
    await q(`insert into items (item_id, name, quality, type, subtype, equip_loc) values
      (90010, 'Bayou Leather Vest', 2, 'Armor', 'Leather', 'INVTYPE_CHEST'),
      (90011, 'Swampweave Gloves', 2, 'Armor', 'Cloth', 'INVTYPE_HAND'),
      (90012, 'Odd Bracers', 2, 'Armor', 'Leather', 'INVTYPE_WRIST'),
      (90013, 'Dropped Gloves', 2, 'Armor', 'Leather', 'INVTYPE_HAND')`);
    await q(`insert into item_snapshots (item_id, build, req_level, ilvl, stats, tooltip) values
      (90010, 61582, 18, 22, '{"ITEM_MOD_AGILITY_SHORT": 30}', '[]'),
      (90011, 61582, 18, 22, '{"ITEM_MOD_AGILITY_SHORT": 30}', '[]'),
      (90012, 61582, 18, 22, '{"ITEM_MOD_AGILITY_SHORT": 30}', '[]'),
      (90013, 61582, 18, 22, '{"ITEM_MOD_AGILITY_SHORT": 3}', '[]')`);
    // Leatherworking makes the vest (a recipe our players scanned, learned by Stitch); Wowhead says a Tailoring spell
    // makes the gloves and some spell of no known profession makes the bracers.
    await q(
      `insert into recipes (recipe_id, name, skill_line_id) values (92010, 'Bayou Leather Vest', 165)`,
    );
    await q(`insert into recipe_snapshots (recipe_id, build, output_item_id, reagents)
             values (92010, 61582, 90010, '[]')`);
    await q(`insert into recipes_learned (char, recipe_id, build, learned_at, via)
             values ('Stitch Less-Bayou', 92010, 61582, now(), 'trainer')`);
    const [src] = await q(
      `insert into sources (key, kind, url, site, tier, game_version)
       values ('wowhead:crafted-test', 'web', 'https://www.wowhead.com/forever/item=90011', 'wowhead.com', 2, 'forever')
       returning id`,
    );
    await q(
      `insert into claims (source_id, entity_type, entity_key, entity_id, attribute, value, value_hash, label, parser)
       values ($1, 'item', '90011', 90011, 'created_by_spell', '{"id":93011,"type":"spell","skills":[197]}', 'c1', 'UNVERIFIED', 'wowhead@4'),
              ($1, 'item', '90012', 90012, 'created_by_spell', '{"id":93012,"type":"spell"}', 'c2', 'UNVERIFIED', 'wowhead@4')`,
      [src.id],
    );

    const a = await gearUpgrades(s.database.db, 'Stitch Less', 'ranged');
    if (!('slots' in a) || !a.slots) throw new Error('no slots');
    const names = a.slots.flatMap((x) => x.upgrades.map((u) => u.name));
    // Their own profession's item stays, marked as theirs to make.
    expect(a.slots.find((x) => x.slotName === 'Chest')!.upgrades[0]).toMatchObject({
      name: 'Bayou Leather Vest',
      crafted: { professions: ['Leatherworking'], byCharacter: true, knowsRecipe: true },
    });
    // The Tailoring gloves and the unknown-profession bracers are out; the weaker dropped gloves take the slot.
    expect(names).not.toContain('Swampweave Gloves');
    expect(names).not.toContain('Odd Bracers');
    expect(a.slots.find((x) => x.slotName === 'Hands')!.upgrades[0]).toMatchObject({
      name: 'Dropped Gloves',
      crafted: null,
    });
    expect(a.professions).toEqual(['Leatherworking']);
    expect(a.gaps.join('\n')).toContain(
      "left out 2 crafted upgrades Stitch Less can't make (Tailoring: 1, an unknown profession: 1",
    );

    const all = await gearUpgrades(s.database.db, 'Stitch Less', 'ranged', {
      includeCrafted: true,
    });
    if (!('slots' in all) || !all.slots) throw new Error('no slots');
    expect(all.slots.find((x) => x.slotName === 'Hands')!.upgrades[0]).toMatchObject({
      name: 'Swampweave Gloves',
      crafted: { professions: ['Tailoring'], byCharacter: false, knowsRecipe: false },
    });
    expect(all.gaps.join('\n')).not.toContain('left out');
  });
});
