// Planner hubs (planner/hubs.ts): quest givers and enders clustered into the places a player stops at.
import { describe, expect, it } from 'vitest';
import { distance, toWorld } from '../src/planner/geo.js';
import { buildHubs } from '../src/planner/hubs.js';
import type { Atlas, AtlasQuest, MapSpot } from '../src/planner/types.js';

type Npc = { id: number; name: string; spots: MapSpot[] };
const npc = (id: number, name: string, spot: MapSpot): Npc => ({ id, name, spots: [spot] });
const quest = (id: number, giver: Npc | null, ender: Npc | null): AtlasQuest => ({
  id,
  title: `Quest ${id}`,
  level: 5,
  reqLevel: 1,
  side: 'Horde',
  classes: null,
  races: null,
  giver,
  ender,
  prereqs: [],
  objectives: [],
  xp: 300,
});
const atlas = (qs: AtlasQuest[]): Atlas => ({ quests: new Map(qs.map((q) => [q.id, q])) });
const yards = (a: MapSpot, b: MapSpot) => distance(toWorld(a)!, toWorld(b)!);

// Tirisfal Glades (1420): Brill and a spot ~400 yd north of it; Durotar (1411) on Kalimdor.
const BRILL = { mapId: 1420, x: 61, y: 52 };
const SIMMER = npc(1, 'Deathguard Simmer', BRILL);
const CAPTAIN = npc(2, 'Executor Zygand', { mapId: 1420, x: 61.5, y: 52 });
const INNKEEPER = npc(3, 'Innkeeper Renee', { mapId: 1420, x: 61, y: 52.5 });
const FARMER = npc(4, 'Far Farmer', { mapId: 1420, x: 61, y: 38.7 });
const ORC = npc(5, 'Durotar Orc', { mapId: 1411, x: 61, y: 52 });

describe('planner hubs', () => {
  it('has the test spots where the test thinks they are', () => {
    expect(yards(BRILL, CAPTAIN.spots[0]!)).toBeLessThan(50);
    expect(yards(BRILL, INNKEEPER.spots[0]!)).toBeLessThan(50);
    expect(yards(CAPTAIN.spots[0]!, INNKEEPER.spots[0]!)).toBeLessThan(50);
    expect(yards(BRILL, FARMER.spots[0]!)).toBeGreaterThan(380);
    expect(yards(BRILL, FARMER.spots[0]!)).toBeLessThan(420);
  });

  it('makes one hub of three NPCs within 50 yd', () => {
    const hubs = buildHubs(
      atlas([
        quest(10, SIMMER, CAPTAIN),
        quest(11, CAPTAIN, INNKEEPER),
        quest(12, INNKEEPER, null),
      ]),
    );
    expect(hubs).toHaveLength(1);
    const [hub] = hubs;
    expect(hub!.name).toBe('near Deathguard Simmer');
    expect(hub!.givers).toEqual([10, 11, 12]);
    expect(hub!.enders).toEqual([10, 11]);
    // The centroid of the three NPCs, and a spot on the first NPC's map.
    const pts = [SIMMER, CAPTAIN, INNKEEPER].map((n) => toWorld(n.spots[0]!)!);
    expect(hub!.pos.continent).toBe(0);
    expect(hub!.pos.x).toBeCloseTo((pts[0]!.x + pts[1]!.x + pts[2]!.x) / 3, 6);
    expect(hub!.pos.y).toBeCloseTo((pts[0]!.y + pts[1]!.y + pts[2]!.y) / 3, 6);
    expect(hub!.spot.mapId).toBe(1420);
    expect(hub!.spot.x).toBeCloseTo(61.1667, 3);
    expect(hub!.spot.y).toBeCloseTo(52.1667, 3);
  });

  it('makes another hub of an NPC 400 yd away', () => {
    const hubs = buildHubs(atlas([quest(10, SIMMER, SIMMER), quest(11, FARMER, FARMER)]));
    expect(hubs.map((h) => h.name)).toEqual(['near Deathguard Simmer', 'near Far Farmer']);
    expect(new Set(hubs.map((h) => h.id)).size).toBe(2);
  });

  it('links NPCs in a chain (single link)', () => {
    // 1 → 2 → 3, each ~120 yd apart, 1 and 3 ~240 yd apart: still one hub.
    const a = npc(1, 'A', { mapId: 1420, x: 61, y: 52 });
    const b = npc(2, 'B', { mapId: 1420, x: 61, y: 56 });
    const c = npc(3, 'C', { mapId: 1420, x: 61, y: 60 });
    expect(yards(a.spots[0]!, b.spots[0]!)).toBeLessThan(150);
    expect(yards(a.spots[0]!, c.spots[0]!)).toBeGreaterThan(150);
    expect(buildHubs(atlas([quest(10, a, b), quest(11, c, null)]))).toHaveLength(1);
  });

  it('never joins NPCs on another continent', () => {
    const hubs = buildHubs(atlas([quest(10, SIMMER, null), quest(11, ORC, null)]));
    expect(hubs).toHaveLength(2);
    expect(hubs.map((h) => h.pos.continent)).toEqual([0, 1]);
  });

  it('lists a quest given at one hub and ended at another in both', () => {
    const hubs = buildHubs(atlas([quest(10, SIMMER, FARMER)]));
    expect(hubs).toHaveLength(2);
    expect(hubs[0]!.givers).toEqual([10]);
    expect(hubs[0]!.enders).toEqual([]);
    expect(hubs[1]!.givers).toEqual([]);
    expect(hubs[1]!.enders).toEqual([10]);
  });

  it('skips NPCs with no spot or an unknown map', () => {
    const lost = npc(6, 'Lost', { mapId: 99999, x: 50, y: 50 });
    const nowhere: Npc = { id: 7, name: 'Nowhere', spots: [] };
    expect(buildHubs(atlas([quest(10, lost, nowhere), quest(11, null, null)]))).toEqual([]);
  });
});
