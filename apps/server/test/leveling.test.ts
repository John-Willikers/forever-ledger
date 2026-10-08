// Leveling routes from our players' quest turn-ins (knowledge/leveling.ts), on real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lookupZone } from '../src/knowledge/answers.js';
import {
  activeMinutes,
  buildGuide,
  levelingRoute,
  objectiveText,
  raceToken,
} from '../src/knowledge/leveling.js';
import type { GuideEvent } from '../src/knowledge/leveling.js';
import { startServer } from './helpers.js';

const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 0, 0) + min * 60_000).toISOString();

describe('leveling helpers', () => {
  it('reads races the way players say them', () => {
    expect(raceToken('undead')).toBe('Scourge');
    expect(raceToken('Trolls')).toBe('Troll');
    expect(raceToken('night elf')).toBe('NightElf');
    expect(raceToken('Tirisfal Glades')).toBeNull();
  });

  it('leaves pauses over an hour out of play time', () => {
    const t = (m: number) => new Date(m * 60_000);
    expect(activeMinutes([t(0), t(10), t(55), t(200), t(205)])).toBe(60);
  });

  it('writes objectives as things to do, not progress', () => {
    expect(objectiveText('Mindless Zombie slain: 0/8')).toBe('Mindless Zombie slain: 8');
    expect(objectiveText('Scavenged Goods: 3/6  ')).toBe('Scavenged Goods: 6');
    expect(objectiveText('Speak with Executor Arren')).toBe('Speak with Executor Arren');
    // Forever puts the count first.
    expect(objectiveText('0/8 Mindless Zombie slain')).toBe('Mindless Zombie slain: 8');
    expect(objectiveText(' 2/6 Scavenger Paw ')).toBe('Scavenger Paw: 6');
  });

  it('groups pickups and turn-ins at one NPC into a step, with the objectives before each turn-in', () => {
    const t = (m: number) => new Date(m * 60_000);
    const ev = (
      e: Partial<GuideEvent> & Pick<GuideEvent, 'kind' | 'at' | 'questId'>,
    ): GuideEvent => ({
      title: `Q${e.questId}`,
      questLevel: 1,
      zone: 'Tirisfal Glades',
      objectives: null,
      npc: null,
      where: null,
      ...e,
    });
    const mordo = { zone: 'Tirisfal Glades', subzone: 'Deathknell', x: 30.21, y: 71.6 };
    const events = [
      ev({ kind: 'accept', at: t(0), questId: 1, npc: 'Mordo', where: mordo }),
      ev({ kind: 'accept', at: t(1), questId: 2, npc: 'Mordo', where: mordo }),
      ev({ kind: 'accept', at: t(2), questId: 9, npc: 'Mordo', where: mordo }), // abandoned
      ev({
        kind: 'turn_in',
        at: t(10),
        questId: 1,
        npc: 'Mordo',
        where: mordo,
        objectives: ['Zombie slain: 2/8'],
        level: 2,
        xp: 50,
      }),
      ev({
        kind: 'turn_in',
        at: t(11),
        questId: 2,
        npc: 'Mordo',
        where: mordo,
        objectives: ['Bone: 0/4'],
        level: 3,
        xp: 90,
      }),
    ];
    const guide = buildGuide(events);
    expect(guide.map((x) => [x.step, x.action, x.npc, x.quests.map((q) => q.questId)])).toEqual([
      [1, 'accept', 'Mordo', [1, 2]],
      [2, 'complete', null, [1, 2]],
      [3, 'turn_in', 'Mordo', [1, 2]],
    ]);
    expect(guide[0]).toMatchObject({ subzone: 'Deathknell', coords: '30.2, 71.6' });
    expect(guide[1]!.quests.map((q) => q.objectives)).toEqual([['Zombie slain: 8'], ['Bone: 4']]);
    expect(guide[2]).toMatchObject({ levelAfter: 3 });
    // Already done by the asker: left out.
    expect(buildGuide(events, new Set([1])).map((x) => x.quests.map((q) => q.questId))).toEqual([
      [2],
      [2],
      [2],
    ]);
  });
});

describe('leveling routes (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = async (text: string, params: unknown[] = []) =>
    (await s.database.pool.query(text, params)).rows;

  beforeAll(async () => {
    s = await startServer();
    await q(`insert into characters (key, name, realm, class, race, level) values
      ('Fast Rot-Bayou', 'Fast Rot', 'Bayou', 'WARRIOR', 'Scourge', 13),
      ('Slow Rot-Bayou', 'Slow Rot', 'Bayou', 'MAGE', 'Scourge', 14),
      ('Low Rot-Bayou', 'Low Rot', 'Bayou', 'PRIEST', 'Scourge', 6),
      ('Plains Walker-Bayou', 'Plains Walker', 'Bayou', 'HUNTER', 'Tauren', 8)`);
    await q(`insert into quests (quest_id, title, level, category) values
      (363, 'Rude Awakening', 1, 'Tirisfal Glades'),
      (364, 'The Mindless Ones', 2, 'Warlock'),
      (365, 'Tainted Scroll', 1, 'Deathknell'),
      (376, 'The Damned', 3, 'Tirisfal Glades'),
      (354, 'Deaths in the Family', 10, 'Tirisfal Glades'),
      (747, 'The Hunt Begins', 1, 'Mulgore')`);
    await q(
      `insert into quest_observations (quest_id, build, stage, char, level, observed_at, npc_name) values
      (363, 70245, 'accept', 'Fast Rot-Bayou', 1, $1, 'Undertaker Mordo'),
      (363, 70245, 'complete', 'Fast Rot-Bayou', 1, $2, 'Shadow Priest Sarvis'),
      (354, 70245, 'accept', 'Fast Rot-Bayou', 12, $3, 'Executor Arren')`,
      [at(0), at(4), at(215)],
    );
    // Forever: the accept event has no NPC; the quest window (detail) just before it has.
    await q(
      `insert into quest_observations (quest_id, build, stage, char, level, observed_at, npc_name, npc_loc, loc) values
      (364, 70245, 'detail', 'Fast Rot-Bayou', 1, $1, 'Shadow Priest Sarvis', $3, null),
      (364, 70245, 'accept', 'Fast Rot-Bayou', 1, $2, null, null, $4),
      (364, 70245, 'complete', 'Fast Rot-Bayou', 3, $5, 'Shadow Priest Sarvis', $3, null)`,
      [
        at(5),
        at(6),
        JSON.stringify({ zone: 'Tirisfal Glades', subzone: 'Deathknell', x: 30.8, y: 66.2 }),
        JSON.stringify({ zone: 'Tirisfal Glades', subzone: 'Deathknell', x: 30.7, y: 66.5 }),
        at(20),
      ],
    );
    await q(`update quests set objectives = $1 where quest_id = 364`, [
      JSON.stringify(['0/8 Mindless Zombie slain']),
    ]);
    // Fast Rot: 1 → 13 in 60 minutes of play with a 3-hour break in the middle.
    const turnIns: [string, number, string, number, number, number][] = [
      ['f1', 363, 'Fast Rot-Bayou', 1, 50, 4],
      ['f2', 364, 'Fast Rot-Bayou', 3, 300, 20],
      ['f3', 376, 'Fast Rot-Bayou', 6, 400, 35],
      ['f4', 354, 'Fast Rot-Bayou', 13, 1500, 35 + 180 + 25],
      // Slow Rot: the same level in 100 minutes of play, no breaks.
      ['s1', 363, 'Slow Rot-Bayou', 1, 50, 0],
      ['s2', 364, 'Slow Rot-Bayou', 5, 300, 50],
      ['s3', 354, 'Slow Rot-Bayou', 13, 1500, 100],
      ['l1', 363, 'Low Rot-Bayou', 6, 50, 10],
      ['l2', 365, 'Low Rot-Bayou', 6, 40, 12],
      ['p1', 747, 'Plains Walker-Bayou', 8, 100, 10],
    ];
    for (const [id, quest, char, level, xp, min] of turnIns) {
      await q(
        `insert into turn_ins (id, quest_id, build, char, level, xp, turned_in_at) values ($1, $2, 70245, $3, $4, $5, $6)`,
        [id, quest, char, level, xp, at(min)],
      );
    }
  });
  afterAll(() => s?.stop());

  it('gives the fastest route by play time for a race, quests in order with their NPCs', async () => {
    const r = await levelingRoute(s.database.db, { start: 'undead', toLevel: 13 });
    expect(r.race).toBe('Scourge');
    expect(r.zones).toEqual(['Tirisfal Glades', 'Deathknell']);
    expect(r.route).toMatchObject({
      character: 'Fast Rot',
      reachedTarget: true,
      activeMinutes: 60,
      wallClockMinutes: 240,
    });
    const guide = r.route!.guide;
    expect(
      guide.filter((x) => x.action === 'turn_in').flatMap((x) => x.quests.map((q) => q.title)),
    ).toEqual(['Rude Awakening', 'The Mindless Ones', 'The Damned', 'Deaths in the Family']);
    expect(guide[0]).toMatchObject({
      action: 'accept',
      npc: 'Undertaker Mordo',
      zone: 'Tirisfal Glades',
    });
    expect(guide[1]).toMatchObject({
      action: 'turn_in',
      npc: 'Shadow Priest Sarvis',
      levelAfter: 1,
    });
    // A pickup without an NPC of its own takes the quest giver from the quest window before it.
    const mindless = guide.find(
      (x) => x.action === 'accept' && x.quests.some((q) => q.questId === 364),
    );
    expect(mindless).toMatchObject({ npc: 'Shadow Priest Sarvis', coords: '30.8, 66.2' });
    // Objectives read as things to do; a class quest's "complete" step is placed by its turn-in, not "Warlock".
    const doIt = guide.find(
      (x) => x.action === 'complete' && x.quests.some((q) => q.questId === 364),
    );
    expect(doIt).toMatchObject({ zone: 'Tirisfal Glades' });
    expect(doIt!.quests[0]!.objectives).toEqual(['Mindless Zombie slain: 8']);
    expect(r.route!.levelUps.at(-1)).toMatchObject({ level: 13, minutesIn: 60 });
    expect(r.otherCharacters.map((c) => [c.character, c.reachedTarget])).toEqual([
      ['Slow Rot', true],
      ['Low Rot', false],
    ]);
    expect(r.zoneQuests.map((x) => x.title)).toContain('Deaths in the Family');
    expect(r.zoneQuests.map((x) => x.title)).toContain('Tainted Scroll'); // filed under Deathknell
    expect(r.zoneQuests.find((x) => x.questId === 363)?.characters).toBe(3);
  });

  it('shows the furthest route when nobody has reached the level, and says so', async () => {
    const r = await levelingRoute(s.database.db, { start: 'Tauren', toLevel: 13 });
    expect(r.route).toMatchObject({ character: 'Plains Walker', reachedTarget: false });
    expect(r.gaps.join('\n')).toContain('no character of ours has reached 13');
    const none = await levelingRoute(s.database.db, { start: 'troll', toLevel: 13 });
    expect(none.route).toBeNull();
    expect(none.gaps[0]).toContain('troll characters has turned in a quest');
  });

  it("personalizes: starts at the asker's level and leaves out what they've done", async () => {
    const r = await levelingRoute(s.database.db, {
      start: 'undead',
      toLevel: 13,
      forCharacter: 'Low Rot',
    });
    // Low Rot is 6 and did Rude Awakening: Fast Rot's run from level 6 on, without it.
    expect(r.fromLevel).toBe(6);
    expect(r.forCharacter).toMatchObject({ name: 'Low Rot', level: 6 });
    const titles = r.route!.guide.flatMap((x) => x.quests.map((q) => q.title));
    expect(titles).not.toContain('Rude Awakening');
    expect(titles).toContain('Deaths in the Family');
  });

  it("follows one character, and the zone lookup lists the zone's quests", async () => {
    const r = await levelingRoute(s.database.db, { character: 'Slow Rot', toLevel: 13 });
    expect(r.route).toMatchObject({ character: 'Slow Rot', activeMinutes: 100 });
    await q(`insert into sources (key, kind, site, tier, game_version)
             values ('test:zones', 'seed', 'test', 3, 'classic')`);
    await q(`insert into claims (source_id, entity_type, entity_key, entity_name, attribute, value, value_hash, label, parser)
             select id, 'zone', 'tirisfal glades', 'Tirisfal Glades', 'level_range', '{"min":1,"max":10}', 'z', 'CLASSIC', 'manual'
               from sources where key = 'test:zones'`);
    const z = await lookupZone(s.database.db, 'Tirisfal Glades');
    if (!('firstParty' in z) || !z.firstParty) throw new Error('no zone');
    expect(
      (z.firstParty as { questsSeen: { title: string }[] }).questsSeen.map((x) => x.title),
    ).toContain('Rude Awakening');
  });
});
