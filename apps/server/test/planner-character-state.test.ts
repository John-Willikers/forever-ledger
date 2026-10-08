// Planner input from a character's stored state (schema 10 tables → CharacterState + TravelData), real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCharacter } from '../src/knowledge/character-state.js';
import { distance, toWorld } from '../src/planner/geo.js';
import { plan } from '../src/planner/plan.js';
import { TRANSPORTS } from '../src/planner/transports.js';
import { FLIGHT_OVERHEAD, FLIGHT_SPEED, groundTravel } from '../src/planner/travel.js';
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

// Forever loads SavedVariables empty at every login (bug #34): a later session uploads only what it saw.
describe('loadCharacter after two sessions (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const ingest = async (batch: object) => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  beforeAll(async () => {
    s = await startServer();
  });
  afterAll(() => s?.stop());

  it('keeps the hearth spot and every map’s flight paths', async () => {
    const b = batchFromFixture('session-v10.lua');
    await ingest(b);
    // Session 2: login reads the bind zone only; a Kalimdor flight map is opened.
    const b2 = structuredClone(b);
    const st = b2.records.charState[0]!;
    const at = st.observedAt! + 3600;
    b2.records.charState = [
      {
        char: st.char,
        build: st.build,
        observedAt: at,
        bind: { zone: 'Goldshire', at },
        taxi: [
          {
            taxiMapId: 1464,
            at,
            nodes: [{ nodeId: 26, name: 'Auberdine', x: 0.4, y: 0.3, state: 1 }],
          },
        ],
      },
    ];
    b2.records.trips = [];
    b2.records.xpCurve = [];
    await ingest(b2);
    const { ch } = (await loadCharacter(s.database.db, CHAR, NOW))!;
    expect(ch.hearth?.spot).toEqual({ mapId: 1429, x: 50, y: 70 });
    expect([...ch.flightPaths].sort((a, b) => a - b)).toEqual([2, 4, 26]);
  });

  it('says how many completed quests were not stored', async () => {
    await s.database.pool.query(
      `update character_state set completed_truncated = 2000 where char = $1`,
      [CHAR],
    );
    const { gaps } = (await loadCharacter(s.database.db, CHAR, NOW))!;
    expect(gaps).toContain('completed quests truncated: 2000 not stored');
  });

  it('no position and no bind spot: a gap, and plan() plans no travel from nowhere', async () => {
    await s.database.pool.query(
      `insert into character_state (char, build, level, observed_at) values ('Nowhere Man-Bayou', 70245, 5, now())`,
    );
    const r = (await loadCharacter(s.database.db, 'Nowhere Man-Bayou', NOW))!;
    expect(r.gaps).toContain('position unknown: log in once with 0.8.0');
    // A quest right where the plan would otherwise start (map 0 is no map).
    const g = { id: 1, name: 'G', spots: [{ mapId: 1429, x: 42, y: 66 }] };
    const atlas = {
      quests: new Map([
        [
          9001,
          {
            ...{ id: 9001, title: 'T', level: 5, reqLevel: 1, side: 'both' as const },
            ...{
              classes: null,
              races: null,
              giver: g,
              ender: g,
              prereqs: [],
              objectives: [],
              xp: 500,
            },
          },
        ],
      ]),
    };
    const p = plan(atlas, r.ch, r.travel, { toLevel: 10 });
    expect(p.steps).toEqual([]);
    expect(p.seconds).toBe(0);
  });
});

// Harlan's real Ratchet → Booty Bay boat (addon 0.8.0, build 70245, 2026-10-08): walking on deck broke the ride into
// two transport trips. And his real Orgrimmar → Ratchet flight, 161.2 s.
describe('loadCharacter: split rides and travel forms (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = async (text: string, values: unknown[] = []) =>
    (await s.database.pool.query(text, values)).rows;
  const SAM = 'Sam Willikers-Bayou';
  const trip = (startedAt: number, seconds: number, from: object, to: object, char = SAM) =>
    q(
      `insert into trips (char, kind, build, started_at, seconds, "from", "to")
       values ($1, 'transport', 70245, to_timestamp($2), $3, $4::jsonb, $5::jsonb)`,
      [char, startedAt, seconds, JSON.stringify(from), JSON.stringify(to)],
    );
  const boat = (travel: { transports: typeof TRANSPORTS }) =>
    travel.transports.find((t) => t.name === 'Booty Bay ↔ Ratchet')!;

  beforeAll(async () => {
    s = await startServer();
    await q(
      `insert into characters (key, name, realm, class, race, faction, level) values
         ($1, 'Sam Willikers', 'Bayou', 'WARRIOR', 'Orc', 'Horde', 30),
         ('Cormier Willikers-Bayou', 'Cormier Willikers', 'Bayou', 'DRUID', 'Tauren', 'Horde', 30),
         ('Guidry Willikers-Bayou', 'Guidry Willikers', 'Bayou', 'SHAMAN', 'Orc', 'Horde', 19)`,
      [SAM],
    );
  });
  afterAll(() => s?.stop());

  it('merges two back-to-back transport trips into one Booty Bay ↔ Ratchet ride', async () => {
    // Trip A alone ends mid-sea (about 250 yd off the Booty Bay dock): no transport matches it.
    await trip(
      1791468085,
      82,
      { mapId: 1413, x: 0.6374, y: 0.3888, zone: 'The Barrens' },
      { mapId: 1434, x: 0.2212, y: 0.7501, zone: 'Stranglethorn Vale' },
    );
    expect(boat((await loadCharacter(s.database.db, SAM, NOW))!.travel)).toEqual(
      TRANSPORTS.find((t) => t.name === 'Booty Bay ↔ Ratchet'),
    );
    // Trip B starts 2 s after A ends, 57 yd from where A ended: one ride, 1791468193 − 1791468085 = 108 s.
    await trip(
      1791468169,
      24,
      { mapId: 1434, x: 0.2299, y: 0.7474, zone: 'Stranglethorn Vale' },
      { mapId: 1434, x: 0.2611, y: 0.7327, zone: 'Booty Bay' },
    );
    const t = boat((await loadCharacter(s.database.db, SAM, NOW))!.travel);
    expect(t.crossing).toBe(108);
    expect(t.confidence).toBe('measured');
    // The guessed docks are within 25 yd of Harlan's ends: they stay guesses.
    expect([t.confidenceA, t.confidenceB]).toEqual(['guess', 'guess']);
  });

  it('does not merge trips too far apart in time or space, or of two characters', async () => {
    const ratchet = { mapId: 1413, x: 0.6374, y: 0.3888 };
    const midSea = { mapId: 1434, x: 0.2212, y: 0.7501 };
    const bootyBay = { mapId: 1434, x: 0.2611, y: 0.7327 };
    const farOff = { mapId: 1434, x: 0.5, y: 0.5 };
    await q(`delete from trips`);
    // 61 s gap; another character's tail; a tail that starts 300+ yd away.
    await trip(1000, 82, ratchet, midSea);
    await trip(1000 + 82 + 61, 24, midSea, bootyBay);
    await trip(5000, 82, ratchet, midSea);
    await trip(5000 + 84, 24, midSea, bootyBay, 'Cormier Willikers-Bayou');
    await trip(9000, 82, ratchet, midSea);
    await trip(9000 + 84, 24, farOff, bootyBay);
    expect(boat((await loadCharacter(s.database.db, SAM, NOW))!.travel)).toEqual(
      TRANSPORTS.find((t) => t.name === 'Booty Bay ↔ Ratchet'),
    );
  });

  it('fits the flight detour from the Orgrimmar → Ratchet flight', async () => {
    await q(
      `insert into character_state (char, build, level, observed_at, taxi) values
         ($1, 70245, 30, to_timestamp($2), $3::jsonb)`,
      [
        SAM,
        NOW,
        JSON.stringify([
          {
            taxiMapId: 1414,
            at: NOW,
            nodes: [
              { nodeId: 23, name: 'Orgrimmar, Durotar', x: 0.581, y: 0.4534, state: 1 },
              { nodeId: 80, name: 'Ratchet, The Barrens', x: 0.5663, y: 0.5582, state: 1 },
            ],
          },
        ]),
      ],
    );
    await q(
      `insert into trips (char, kind, build, started_at, seconds, from_node, to_node)
       values ($1, 'flight', 70245, to_timestamp($2), 161.2, $3::jsonb, $4::jsonb)`,
      [
        SAM,
        1791467800,
        JSON.stringify({ nodeId: 23, name: 'Orgrimmar, Durotar' }),
        JSON.stringify({ nodeId: 80, name: 'Ratchet, The Barrens' }),
      ],
    );
    const { travel } = (await loadCharacter(s.database.db, SAM, NOW))!;
    expect(travel.flightDetour).toBeCloseTo(1.7, 2);
  });

  it('a druid or shaman loads with its class and level, which route() turns into a travel form', async () => {
    const druid = (await loadCharacter(s.database.db, 'Cormier Willikers-Bayou', NOW))!.ch;
    expect(groundTravel(druid)).toEqual({ speed: 9.8, form: 'Travel Form' });
    const shaman = (await loadCharacter(s.database.db, 'Guidry Willikers-Bayou', NOW))!.ch;
    expect(groundTravel(shaman)).toEqual({ speed: 7 });
  });
});
