// Planner input from a character's stored state (schema 10 tables → CharacterState + TravelData), real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCharacter } from '../src/knowledge/character-state.js';
import { distance, toWorld } from '../src/planner/geo.js';
import { TRANSPORTS } from '../src/planner/transports.js';
import { FLIGHT_OVERHEAD, FLIGHT_SPEED } from '../src/planner/travel.js';
import { batchFromFixture, startServer } from './helpers.js';

const CHAR = 'Thibodeaux Willikers-Bayou';
/** The fixture state's `at`: the planner clock starts here. */
const NOW = 1790001827;

describe('loadCharacter (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = async (text: string, values: unknown[] = []) =>
    (await s.database.pool.query(text, values)).rows;
  const load = (key: string) => loadCharacter(s.database.db, key, NOW);

  beforeAll(async () => {
    s = await startServer();
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batchFromFixture('session-v10.lua'),
    });
    expect(res.statusCode, res.body).toBe(200);
  });
  afterAll(() => s?.stop());

  it('turns a stored state into the planner character', async () => {
    const r = await load(CHAR);
    expect(r).not.toBeNull();
    const { ch, gaps } = r!;
    expect(ch).toMatchObject({
      level: 11,
      xp: 4350,
      className: 'HUNTER',
      race: 'Human',
      faction: 'Alliance',
      mounted: true,
    });
    expect([...ch.completed].sort((a, b) => a - b)).toEqual([7, 15, 33, 783, 5261]);
    expect(ch.log).toEqual(
      new Map([
        [1234, [0]],
        [364, [2]],
      ]),
    );
    expect(ch.position.mapId).toBe(1429);
    expect(ch.position.x).toBeCloseTo(43.58, 6);
    expect(ch.position.y).toBeCloseTo(65.78, 6);
    // State 0 (current) and 1 (learned) are known; 2 (not learned) is not.
    expect([...ch.flightPaths].sort((a, b) => a - b)).toEqual([2, 4]);
    expect(ch.hearth).toEqual({ spot: { mapId: 1429, x: 50, y: 70 }, readyAt: 3000 });
    expect(gaps).toEqual([]);
    expect(r!.xpCurve).toEqual(
      new Map([
        [10, 7600],
        [11, 8740],
      ]),
    );
  });

  it('a ready hearth is ready now; an unknown character is null', async () => {
    const r = await loadCharacter(s.database.db, CHAR, NOW + 10_000);
    expect(r!.ch.hearth!.readyAt).toBe(0);
    expect(await load('Nobody-Bayou')).toBeNull();
  });

  it('flight nodes: every character’s taxi maps merged by node id, on the continent map, with a faction', async () => {
    const before = (await load(CHAR))!.travel.flightNodes;
    expect(before.map((n) => n.id).sort((a, b) => a - b)).toEqual([2, 4, 6]);
    // Synthetic taxi map 1415: the spot is already on the continent map.
    const sw = before.find((n) => n.id === 2)!;
    expect(sw).toMatchObject({ name: 'Stormwind, Elwynn', faction: 'Alliance' });
    expect(sw.spot.mapId).toBe(1415);
    expect(sw.spot.x).toBeCloseTo(42.82, 6);
    expect(sw.spot.y).toBeCloseTo(65.33, 6);

    // A Horde character at the Orgrimmar flight master: taxi map 1464 (probe 0.6.0 taxi window positions).
    await q(
      `insert into characters (key, name, realm, class, race, faction, level)
       values ('Boudreaux Willikers-Bayou', 'Boudreaux Willikers', 'Bayou', 'WARRIOR', 'Orc', 'Horde', 14)`,
    );
    await q(
      `insert into character_state (char, build, level, observed_at, taxi) values
         ('Boudreaux Willikers-Bayou', 70245, 14, to_timestamp($1), $2::jsonb)`,
      [
        NOW,
        JSON.stringify([
          {
            taxiMapId: 1464,
            at: NOW,
            nodes: [
              { nodeId: 23, name: 'Orgrimmar, Durotar', x: 0.628, y: 0.4434, state: 0 },
              { nodeId: 22, name: 'Thunder Bluff, Mulgore', x: 0.4495, y: 0.5615, state: 1 },
              { nodeId: 9999, name: 'Somewhere New', x: 0.5, y: 0.5, state: 2 },
            ],
          },
          // A node another character already reported: kept once.
          { taxiMapId: 1415, at: NOW, nodes: [{ nodeId: 2, x: 0.4282, y: 0.6533, state: 2 }] },
        ]),
      ],
    );
    const { ch, travel } = (await load('Boudreaux Willikers-Bayou'))!;
    expect(ch).toMatchObject({ className: 'WARRIOR', race: 'Orc', faction: 'Horde' });
    expect([...ch.flightPaths].sort((a, b) => a - b)).toEqual([22, 23]);
    const ids = travel.flightNodes.map((n) => n.id).sort((a, b) => a - b);
    expect(ids).toEqual([2, 4, 6, 22, 23, 9999]);
    const org = travel.flightNodes.find((n) => n.id === 23)!;
    expect(org.faction).toBe('Horde');
    // Taxi map 1464 → Kalimdor (1414): the probe's GetTaxiNodesForMap(1414) has Orgrimmar at 58.1, 45.34.
    expect(org.spot.mapId).toBe(1414);
    expect(org.spot.x).toBeCloseTo(58.1, 0);
    expect(org.spot.y).toBeCloseTo(45.34, 0);
    // A node the probe never listed: no faction known.
    expect(travel.flightNodes.find((n) => n.id === 9999)!.faction).toBe('both');
  });

  it('a missing bind spot gives no hearth and a gap', async () => {
    await q(
      `insert into characters (key, name, realm, class, race, faction, level)
       values ('Fontenot Willikers-Bayou', 'Fontenot Willikers', 'Bayou', 'MAGE', 'Gnome', 'Alliance', 5)`,
    );
    await q(
      `insert into character_state (char, build, level, xp, observed_at, pos, bind) values
         ('Fontenot Willikers-Bayou', 70245, 5, 10, to_timestamp($1), $2::jsonb, $3::jsonb)`,
      [NOW, JSON.stringify({ mapId: 1426, x: 0.3, y: 0.7 }), JSON.stringify({ zone: 'Kharanos' })],
    );
    const { ch, gaps } = (await load('Fontenot Willikers-Bayou'))!;
    expect(ch.hearth).toBeNull();
    expect(ch.mounted).toBe(false);
    expect(gaps).toContain('bind spot unknown: set your hearth once with 0.8.0');
  });

  it('recorded transport rides set the crossing; recorded flights fit the detour', async () => {
    const yards = distance(
      toWorld({ mapId: 1415, x: 42.82, y: 65.33 })!,
      toWorld({ mapId: 1415, x: 40.19, y: 72.62 })!,
    );
    const detour = (secs: number) => ((secs - FLIGHT_OVERHEAD) * FLIGHT_SPEED) / yards;
    const before = (await load(CHAR))!.travel;
    expect(before.transports).toEqual(TRANSPORTS);
    // The fixture's one flight, Sentinel Hill → Stormwind in 72.4 s.
    expect(before.flightDetour).toBeCloseTo(detour(72.4), 6);

    const tirisfal = { mapId: 1420, x: 0.607, y: 0.588, zone: 'Tirisfal Glades' };
    const durotar = { mapId: 1411, x: 0.508, y: 0.126, zone: 'Durotar' };
    const far = { mapId: 1429, x: 0.4, y: 0.6, zone: 'Elwynn Forest' };
    const rides: [number, object, object, number][] = [
      [1, tirisfal, durotar, 60],
      [2, tirisfal, durotar, 100],
      [3, durotar, tirisfal, 64],
      [4, far, durotar, 999],
    ];
    for (const [i, from, to, secs] of rides) {
      await q(
        `insert into trips (char, kind, build, started_at, seconds, "from", "to")
         values ($1, 'transport', 70245, to_timestamp($2), $3, $4::jsonb, $5::jsonb)`,
        [CHAR, NOW + i, secs, JSON.stringify(from), JSON.stringify(to)],
      );
    }
    // Sentinel Hill (4) → Stormwind (2): the fixture has one at 72.4 s; two more, median 80.
    for (const [i, secs] of [
      [10, 80],
      [11, 95],
    ] as const) {
      await q(
        `insert into trips (char, kind, build, started_at, seconds, from_node, to_node)
         values ($1, 'flight', 70245, to_timestamp($2), $3, $4::jsonb, $5::jsonb)`,
        [
          CHAR,
          NOW + i,
          secs,
          JSON.stringify({ nodeId: 4, name: 'Sentinel Hill, Westfall' }),
          JSON.stringify({ nodeId: 2, name: 'Stormwind, Elwynn' }),
        ],
      );
    }

    const { travel } = (await load(CHAR))!;
    const zep = travel.transports.find((t) => t.name === 'Tirisfal Glades ↔ Durotar')!;
    expect(zep.crossing).toBe(64);
    expect(zep.wait).toBe(150);
    expect(zep.confidence).toBe('measured');
    for (const t of travel.transports.filter((t) => t.name !== zep.name)) {
      expect(t).toEqual(TRANSPORTS.find((x) => x.name === t.name));
    }

    expect(travel.flightDetour).toBeCloseTo(detour(80), 6);
  });
});
