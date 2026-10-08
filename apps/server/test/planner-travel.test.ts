// Planner travel network (planner/travel.ts): walk, learned flights, boats / zeppelins and the hearthstone, Dijkstra on
// seconds.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { distance, toWorld } from '../src/planner/geo.js';
import {
  FLIGHT_SPEED,
  flightSeconds,
  groundTravel,
  route,
  type TravelData,
} from '../src/planner/travel.js';
import { TRANSPORTS } from '../src/planner/transports.js';
import type { CharacterState, MapSpot } from '../src/planner/types.js';

type Ch = Pick<
  CharacterState,
  'faction' | 'flightPaths' | 'hearth' | 'mounted' | 'className' | 'level'
>;
const horde = (over: Partial<Ch> = {}): Ch => ({
  faction: 'Horde',
  className: 'WARRIOR',
  level: 10,
  flightPaths: new Set(),
  hearth: null,
  mounted: false,
  ...over,
});

// Kalimdor flight nodes on the continent map (map 1414 coords 0..1 in the probe → percent here).
const ORG: MapSpot = { mapId: 1414, x: 58.1, y: 45.34 };
const GADGETZAN: MapSpot = { mapId: 1414, x: 56.65, y: 80.91 };
const DATA: TravelData = {
  flightNodes: [
    { id: 23, name: 'Orgrimmar', faction: 'Horde', spot: ORG },
    { id: 40, name: 'Gadgetzan', faction: 'Horde', spot: GADGETZAN },
  ],
  transports: TRANSPORTS.filter((t) => t.name === 'Tirisfal Glades ↔ Durotar'),
};
const yards = (a: MapSpot, b: MapSpot) => distance(toWorld(a)!, toWorld(b)!);

describe('planner travel', () => {
  it('walks on one map when nothing faster exists', () => {
    const a = { mapId: 1420, x: 61, y: 52 };
    const b = { mapId: 1420, x: 40, y: 50 };
    const r = route(a, b, horde(), DATA, 0)!;
    expect(r.legs.map((l) => l.how)).toEqual(['walk']);
    expect(r.seconds).toBeCloseTo(yards(a, b) / 7, 3);
    // Mounted: Classic riding at 40, +60 %.
    expect(route(a, b, horde({ mounted: true }), DATA, 0)!.seconds).toBeCloseTo(
      yards(a, b) / 11.2,
      3,
    );
  });

  it('uses Travel Form (druid 30+) and Ghost Wolf (shaman 20+) at +40 %, unless a mount is faster', () => {
    const a = { mapId: 1420, x: 61, y: 52 };
    const b = { mapId: 1420, x: 40, y: 50 };
    const d = yards(a, b);
    const go = (over: Partial<Ch>) => route(a, b, horde(over), DATA, 0)!;

    const druid = go({ className: 'DRUID', level: 30 });
    expect(druid.seconds).toBeCloseTo(d / 9.8, 3);
    expect(druid.legs).toMatchObject([{ how: 'walk', note: 'Travel Form' }]);
    const wolf = go({ className: 'SHAMAN', level: 20 });
    expect(wolf.seconds).toBeCloseTo(d / 9.8, 3);
    expect(wolf.legs).toMatchObject([{ how: 'walk', note: 'Ghost Wolf' }]);

    // Below the training level: on foot, no note.
    for (const over of [
      { className: 'DRUID', level: 29 },
      { className: 'SHAMAN', level: 19 },
      { className: 'WARRIOR', level: 60 },
    ]) {
      const r = go(over);
      expect(r.seconds).toBeCloseTo(d / 7, 3);
      expect(r.legs[0]!.note).toBeUndefined();
    }
    // A mount (riding 40, +60 %) beats the form.
    const mounted = go({ className: 'DRUID', level: 40, mounted: true });
    expect(mounted.seconds).toBeCloseTo(d / 11.2, 3);
    expect(mounted.legs[0]!.note).toBeUndefined();

    expect(groundTravel({ className: 'DRUID', level: 30, mounted: false })).toEqual({
      speed: 9.8,
      form: 'Travel Form',
    });
    expect(groundTravel({ className: 'SHAMAN', level: 25, mounted: true })).toEqual({
      speed: 11.2,
    });
  });

  it('flies between two learned nodes far apart', () => {
    const a = { mapId: 1411, x: 45, y: 10 }; // Orgrimmar gates, Durotar
    const b = { mapId: 1446, x: 51, y: 28 }; // Gadgetzan, Tanaris
    const r = route(a, b, horde({ flightPaths: new Set([23, 40]) }), DATA, 0)!;
    expect(r.legs.map((l) => l.how)).toEqual(['walk', 'fly', 'walk']);
    expect(r.seconds).toBeLessThan(yards(a, b) / 7);
    expect(r.seconds).toBeCloseTo(
      r.legs.reduce((s, l) => s + l.seconds, 0),
      6,
    );
  });

  it('times flights with the travel data’s detour factor when it has one', () => {
    const a = { mapId: 1411, x: 45, y: 10 };
    const b = { mapId: 1446, x: 51, y: 28 };
    const ch = horde({ flightPaths: new Set([23, 40]) });
    const fly = (data: TravelData) =>
      route(a, b, ch, data, 0)!.legs.find((l) => l.how === 'fly')!.seconds;
    const d = yards(ORG, GADGETZAN);
    expect(fly(DATA)).toBeCloseTo(flightSeconds(d), 6);
    expect(fly({ ...DATA, flightDetour: 1.5 })).toBeCloseTo((d * 1.5) / FLIGHT_SPEED + 15, 6);
    expect(flightSeconds(d, 1.5)).toBeCloseTo((d * 1.5) / FLIGHT_SPEED + 15, 6);
  });

  it('never uses an unlearned node', () => {
    const a = { mapId: 1411, x: 45, y: 10 };
    const b = { mapId: 1446, x: 51, y: 28 };
    const r = route(a, b, horde({ flightPaths: new Set([23]) }), DATA, 0)!;
    expect(r.legs.map((l) => l.how)).toEqual(['walk']);
  });

  it('crosses continents by zeppelin, Horde only', () => {
    const brill = { mapId: 1420, x: 61, y: 52 };
    const razor = { mapId: 1411, x: 52, y: 44 }; // Razor Hill, Durotar
    const r = route(brill, razor, horde(), DATA, 0)!;
    expect(r.legs.map((l) => l.how)).toEqual(['walk', 'boat', 'walk']);
    expect(r.legs[1]!.seconds).toBe(70 + 150);
    expect(route(brill, razor, { ...horde(), faction: 'Alliance' }, DATA, 0)).toBeNull();
  });

  it('hearths when the stone is ready by the clock, or waits for it when that is still faster', () => {
    const a = { mapId: 1420, x: 40, y: 50 };
    const target = { mapId: 1411, x: 52, y: 44 };
    const bind = { mapId: 1411, x: 51.5, y: 41.5 };
    const ready = route(a, target, horde({ hearth: { spot: bind, readyAt: 0 } }), DATA, 0)!;
    expect(ready.legs.map((l) => l.how)).toEqual(['hearth', 'walk']);
    expect(ready.legs[0]!.seconds).toBe(20);

    const cooling = horde({ hearth: { spot: bind, readyAt: 1800 } });
    expect(route(a, target, cooling, DATA, 0)!.legs.map((l) => l.how)).not.toContain('hearth');
    expect(route(a, target, cooling, DATA, 1800)!.legs.map((l) => l.how)).toEqual([
      'hearth',
      'walk',
    ]);
  });

  it('waits for the hearth only when the wait beats walking', () => {
    // Across Durotar: 4230 yd, about 604 s on foot.
    const a = { mapId: 1411, x: 10, y: 50 };
    const target = { mapId: 1411, x: 90, y: 50 };
    const bind = { mapId: 1411, x: 89, y: 50 };
    const soon = route(a, target, horde({ hearth: { spot: bind, readyAt: 160 } }), DATA, 100)!;
    expect(soon.legs.map((l) => l.how)).toEqual(['hearth', 'walk']);
    expect(soon.legs[0]!.seconds).toBe(60 + 20);
    expect(soon.legs[0]!.note).toBe('wait 60 s');
    const late = route(a, target, horde({ hearth: { spot: bind, readyAt: 3100 } }), DATA, 100)!;
    expect(late.legs.map((l) => l.how)).toEqual(['walk']);
  });

  it('skips a ready hearth when walking is faster', () => {
    const a = { mapId: 1411, x: 52, y: 44 };
    const target = { mapId: 1411, x: 52.2, y: 44 };
    const r = route(a, target, horde({ hearth: { spot: target, readyAt: 0 } }), DATA, 0)!;
    expect(r.legs.map((l) => l.how)).toEqual(['walk']);
  });

  it("ignores another faction's flight node even when its id is learned", () => {
    const a = { mapId: 1411, x: 45, y: 10 };
    const b = { mapId: 1446, x: 51, y: 28 };
    const data: TravelData = {
      ...DATA,
      flightNodes: [
        DATA.flightNodes[0]!,
        { id: 39, name: 'Gadgetzan', faction: 'Alliance', spot: GADGETZAN },
      ],
    };
    const r = route(a, b, horde({ flightPaths: new Set([23, 39]) }), data, 0)!;
    expect(r.legs.map((l) => l.how)).toEqual(['walk']);
  });

  it('lets both factions ride a neutral boat', () => {
    const data: TravelData = { flightNodes: [], transports: [...TRANSPORTS] };
    const bootyBay = { mapId: 1434, x: 27, y: 77 };
    const ratchet = { mapId: 1413, x: 62, y: 37 };
    const r = route(bootyBay, ratchet, { ...horde(), faction: 'Alliance' }, data, 0)!;
    expect(r.legs.map((l) => l.how)).toContain('boat');
    expect(r.legs.find((l) => l.how === 'boat')!.note).toBe('Booty Bay ↔ Ratchet');
  });

  it('never swims between the two ends of one transport', () => {
    const data: TravelData = { flightNodes: [], transports: [...TRANSPORTS] };
    const auberdine = { mapId: 1439, x: 34, y: 41 };
    const ruttheran = { mapId: 1438, x: 55.5, y: 94 };
    const alliance = { ...horde({ mounted: true }), faction: 'Alliance' as const };
    const r = route(auberdine, ruttheran, alliance, data, 0)!;
    expect(r.legs.map((l) => l.how)).toContain('boat');
  });

  it('estimates the Orgrimmar → Splintertree Post flight within 40 % of the probe trip', () => {
    // Probe 0.6.0 trip 1 (build 70245, 2026-10-08 04:53 CDT): 89.7 s from TakeTaxiNode to PLAYER_CONTROL_GAINED.
    const fx = JSON.parse(
      readFileSync(
        new URL('../../../fixtures/real/probe-70245-travel.json', import.meta.url),
        'utf8',
      ),
    ) as {
      snapshot: {
        taxi: Record<
          string,
          { forMap: { nodes: { nodeID: number; position: [number, number] }[] } }
        >;
      };
    };
    const at = (id: number): MapSpot => {
      const n = fx.snapshot.taxi['1414']!.forMap.nodes.find((x) => x.nodeID === id)!;
      return { mapId: 1414, x: 100 * n.position[0], y: 100 * n.position[1] };
    };
    const org = at(23);
    const splinter = at(61);
    const data: TravelData = {
      flightNodes: [
        { id: 23, name: 'Orgrimmar', faction: 'Horde', spot: org },
        { id: 61, name: 'Splintertree Post', faction: 'Horde', spot: splinter },
      ],
      transports: [],
    };
    const r = route(org, splinter, horde({ flightPaths: new Set([23, 61]) }), data, 0)!;
    expect(r.legs.map((l) => l.how)).toEqual(['fly']);
    expect(r.seconds).toBeGreaterThan(89.7 * 0.6);
    expect(r.seconds).toBeLessThan(89.7 * 1.4);
  });

  it('records the Orgrimmar → Ratchet flight: the default detour is short, recorded flights fit it', () => {
    // Harlan (Sam Willikers, addon 0.8.0, build 70245, 2026-10-08): node 23 → node 80 in 161.2 s. The straight line
    // on map 1414 is about 2627 yd, so the default 1.25 detour says about 123 s (measured / estimate ≈ 1.31) and the
    // detour this flight implies is about 1.70 (the path bends via the Crossroads). loadCharacter fits it from trips.
    const org = { mapId: 1414, x: 58.1, y: 45.34 };
    const ratchet = { mapId: 1414, x: 56.63, y: 55.82 };
    const d = yards(org, ratchet);
    expect(d).toBeCloseTo(2627, -1);
    expect(161.2 / flightSeconds(d)).toBeCloseTo(1.31, 2);
    expect(((161.2 - 15) * FLIGHT_SPEED) / d).toBeCloseTo(1.7, 2);
  });
});
