// The MCP server's answers (project-plans/forever-ledger-mcp-server.md): only from the ledger, first-party first, claims
// ranked by tier with labels, FALSE never a fact, and gaps when the ledger doesn't know.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkClaim,
  fishingAnswer,
  lookupItem,
  lookupNpc,
  lookupQuest,
  lookupZone,
  searchEntities,
  whereToGet,
} from '../src/knowledge/answers.js';
import { importSeed } from '../src/knowledge/seed.js';
import { enqueueUrl } from '../src/knowledge/store.js';
import { startServer } from './helpers.js';

describe('MCP answers (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = (text: string, params: unknown[] = []) => s.database.pool.query(text, params);

  beforeAll(async () => {
    s = await startServer();
    await q(`insert into items (item_id, name) values (7973, 'Big-mouth Clam'), (7971, 'Black Pearl'),
                                                     (6303, 'Raw Slitherskin Mackerel')`);
    await q(`insert into quests (quest_id, title, level) values (91775, 'Book Return', 6)`);
    await q(`insert into vendors (npc_id, build, name, items, seen_at)
             values (3333, 70245, 'Shankys', '[{"itemId": 6303, "price": 4}]', now())`);
    // Our own kills: 2 clams from 4 Steeljaw Snappers.
    await q(`insert into drops (item_id, build, npc_id, uploader_id, account, session, count, quantity)
             values (7973, 70245, 2505, 'pc-1', 'A', 's1', 2, 2)`);
    await q(`insert into corpses (npc_id, build, uploader_id, account, session, count, copper)
             values (2505, 70245, 'pc-1', 'A', 's1', 4, 0)`);
    await importSeed(s.database.db, {
      sources: [
        { key: 'seed:wh-clam', url: 'https://www.wowhead.com/classic/item=7973/big-mouth-clam' },
        { key: 'seed:forum', site: 'forum.example', tier: 6 },
        { key: 'seed:ai', site: 'google-ai', tier: 7 },
        {
          key: 'seed:zones',
          url: 'https://mobalytics.gg/wow-forever/guides/zone-map-level-ranges',
        },
      ],
      claims: [
        ...Array.from({ length: 20 }, (_, i) => ({
          source: 'seed:wh-clam',
          entityType: 'item' as const,
          entityId: 7973,
          attribute: 'dropped_by',
          value: { id: 1000 + i, type: 'npc', name: `Murloc ${i}`, count: 100 * (i + 1) },
          label: 'CLASSIC' as const,
        })),
        {
          source: 'seed:forum',
          entityType: 'item',
          entityName: 'Black Pearl',
          attribute: 'comes_from',
          value: 'Big-mouth Clam',
          label: 'ANECDOTE',
        },
        {
          source: 'seed:ai',
          entityType: 'profession',
          entityName: 'Fishing',
          attribute: 'craft_fishing_hut',
          value: { skill: 225 },
          label: 'FALSE',
          quote: 'You can craft a Fishing Hut at 225 fishing skill',
        },
        {
          source: 'seed:zones',
          entityType: 'zone',
          entityName: 'Tanaris',
          attribute: 'level_range',
          value: { min: 40, max: 50 },
          label: 'VERIFIED',
        },
      ],
      observations: [
        {
          key: 'steamwheedle',
          observedAt: '2026-10-06T20:00:00-05:00',
          build: 70235,
          location: { zone: 'Tanaris', subzone: 'Steamwheedle Port' },
          method: 'fishing',
          result: { bigMouthClams: 0, catches: 40 },
          claims: [
            {
              entityType: 'item',
              entityId: 7973,
              attribute: 'fishing_yield',
              value: { zone: 'Tanaris', caught: 0, minutes: 40 },
            },
          ],
        },
      ],
    });
    await enqueueUrl(s.database.db, {
      url: 'https://www.wowhead.com/forever/item=7973',
      addedBy: 'cli',
      priority: 50,
      entityType: 'item',
      entityId: 7973,
    });
  });
  afterAll(() => s?.stop());

  it('search finds entities by name or id, one hit each, exact names first', async () => {
    const hits = await searchEntities(s.database.db, 'clam');
    expect(hits[0]).toMatchObject({ type: 'item', id: 7973, name: 'Big-mouth Clam' });
    expect(hits.filter((h) => h.name === 'Big-mouth Clam')).toHaveLength(1);
    expect((await searchEntities(s.database.db, '91775'))[0]).toMatchObject({
      type: 'quest',
      name: 'Book Return',
    });
    expect(await searchEntities(s.database.db, 'Tanaris', 'zone')).toContainEqual(
      expect.objectContaining({ type: 'zone', name: 'Tanaris' }),
    );
  });

  it('where_to_get puts our own observations first, then claims by tier, capped per attribute', async () => {
    const a = await whereToGet(s.database.db, 'Big-mouth Clam');
    expect(a.entity).toMatchObject({ id: 7973 });
    expect(a.firstParty).toMatchObject({
      drops: [{ npcId: 2505, dropped: 2, kills: 4, perKill: 0.5 }],
      observations: [{ key: 'steamwheedle', result: { bigMouthClams: 0 } }],
    });
    expect(a.facts[0]).toMatchObject({ tier: 1, label: 'VERIFIED', attribute: 'fishing_yield' });
    const drops = a.facts.filter((f) => f.attribute === 'dropped_by');
    expect(drops).toHaveLength(12);
    // The biggest droppers survive the cap.
    expect((drops[0]!.value as { count: number }).count).toBe(2000);
    expect(a.gaps).toContain('8 more facts not shown (the best 13, at most 12 per attribute)');
    expect(a.gaps).toContain('its Wowhead page is not fetched yet (queued)');
  });

  it('names a looted NPC from any page that lists it, and says when it has no name', async () => {
    const before = await whereToGet(s.database.db, 7973);
    expect(before.firstParty).toMatchObject({ drops: [{ npcId: 2505, npcName: null }] });
    await importSeed(s.database.db, {
      sources: [{ key: 'seed:wh-mackerel', url: 'https://www.wowhead.com/classic/item=6303' }],
      claims: [
        {
          source: 'seed:wh-mackerel',
          entityType: 'item',
          entityId: 6303,
          attribute: 'dropped_by',
          value: { id: 2505, type: 'npc', name: 'Saltwater Snapjaw', count: 4 },
          label: 'CLASSIC',
        },
      ],
    });
    const after = await whereToGet(s.database.db, 7973);
    expect(after.firstParty).toMatchObject({
      drops: [{ npcId: 2505, npcName: 'Saltwater Snapjaw', dropped: 2, kills: 4 }],
    });
    expect((await lookupNpc(s.database.db, 2505)).entity).toEqual({
      type: 'npc',
      id: 2505,
      name: 'Saltwater Snapjaw',
    });
    expect((await searchEntities(s.database.db, 'snapjaw', 'npc'))[0]).toMatchObject({ id: 2505 });
  });

  it('a seed claim by name and an item by id are the same item', async () => {
    const a = await lookupItem(s.database.db, 7971);
    expect(a.entity).toMatchObject({ id: 7971, name: 'Black Pearl' });
    expect(a.facts.map((f) => [f.attribute, f.label])).toEqual([['comes_from', 'ANECDOTE']]);
    expect(a.gaps).toContain(
      'no first-party observations in the ledger yet (none of our uploads saw it)',
    );
    expect(a.gaps.some((g) => g.startsWith('no VERIFIED Forever fact'))).toBe(true);
  });

  it('says plainly when the ledger knows nothing', async () => {
    expect((await lookupItem(s.database.db, 'Thunderfury')).gaps).toEqual([
      'the ledger has no item matching "Thunderfury"',
    ]);
    const npc = await lookupNpc(s.database.db, 4242);
    expect(npc.entity).toEqual({ type: 'npc', id: 4242, name: null });
    expect(npc.gaps).toContain(
      'the ledger knows nothing about it yet: no observations and no claims',
    );
  });

  it('quests, NPCs and zones', async () => {
    const quest = await lookupQuest(s.database.db, 'Book Return');
    expect(quest.firstParty).toMatchObject({ quest: { questId: 91775, level: 6 } });
    const vendor = await lookupNpc(s.database.db, 'Shankys');
    expect(vendor.firstParty).toMatchObject({ vendor: [{ name: 'Shankys', itemsSold: 1 }] });
    const zone = await lookupZone(s.database.db, 'tanaris');
    expect(zone.facts).toMatchObject([{ attribute: 'level_range', value: { min: 40, max: 50 } }]);
    const fishing = await fishingAnswer(s.database.db, { item: 'Big-mouth Clam' });
    expect(fishing.facts.map((f) => f.attribute)).toEqual(['fishing_yield']);
  });

  it('an id-only claim never names its entity with another attribute', async () => {
    // Item 7973's claims carry its id but no name except the `name` claim: the lookup must not be named "Murloc 0".
    await q(`delete from items where item_id = 7973`);
    const a = await lookupItem(s.database.db, '7973');
    expect(a.entity).toEqual({ type: 'item', id: 7973, name: null });
    expect(a.facts.some((f) => f.attribute === 'fishing_yield')).toBe(true);
    await q(`insert into items (item_id, name) values (7973, 'Big-mouth Clam')`);
  });

  it('check_claim lists every FALSE claim, whatever the caps', async () => {
    await importSeed(s.database.db, {
      sources: [{ key: 'seed:ai2', site: 'other-ai', tier: 7 }],
      claims: [
        {
          source: 'seed:ai2',
          entityType: 'item',
          entityId: 7973,
          attribute: 'dropped_by',
          value: { id: 99, type: 'npc', name: 'Clam King', count: 1 },
          label: 'FALSE',
        },
      ],
    });
    const a = await checkClaim(s.database.db, 'Clam King drops it', { type: 'item', ref: 7973 });
    expect(a.refuted).toMatchObject([{ attribute: 'dropped_by', value: { name: 'Clam King' } }]);
  });

  it('check_claim lists FALSE claims as refuted, never as facts', async () => {
    const a = await checkClaim(s.database.db, 'craft a Fishing Hut at 225');
    expect(a.facts).toEqual([]);
    expect(a.refuted).toMatchObject([{ attribute: 'craft_fishing_hut', label: 'FALSE', tier: 7 }]);
    expect(a.disputes).toContainEqual(expect.objectContaining({ label: 'FALSE' }));
    const none = await checkClaim(s.database.db, 'gnomes can be shamans');
    expect(none.gaps).toContain(
      'the ledger has nothing on this: it can neither confirm nor refute it',
    );
  });
});
