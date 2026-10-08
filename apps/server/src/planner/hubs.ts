// Planner hubs: the places a player stops at to pick up and hand in quests. Every quest giver and ender (its first
// spot) is a point; points within HUB_LINK yards of each other on one continent are linked (single-link clustering), and
// each connected group is a hub at the centroid of its NPCs. Givers and enders are NPCs, objects or items: each kind has
// its own id space, so a point is keyed by kind and id. Pure.
import { distance, fromWorld, mapInfo, toWorld } from './geo.js';
import type { Atlas, MapSpot, QuestPoint, WorldPos } from './types.js';

export interface Hub {
  /** Stable: a hash of the hub's smallest member key, so unrelated quests never renumber it. */
  id: number;
  pos: WorldPos;
  /**
   * The centroid on the largest member map that contains it (a zone before a city); else on the first NPC's map, else
   * that NPC's own spot.
   */
  spot: MapSpot;
  /** "near <first NPC>" until the atlas carries subzones. */
  name: string;
  /** Quest ids given / ended by an NPC of this hub, ascending. */
  givers: number[];
  enders: number[];
}

/** Two NPCs this close (yards) belong to one hub. */
export const HUB_LINK = 150;

interface Point {
  key: string;
  name: string;
  spot: MapSpot;
  pos: WorldPos;
  givers: Set<number>;
  enders: Set<number>;
}

export function buildHubs(atlas: Atlas): Hub[] {
  // One point per NPC, in the order the atlas first names it.
  const points = new Map<string, Point>();
  const add = (who: QuestPoint | null, questId: number, role: 'givers' | 'enders') => {
    if (!who) return;
    const key = `${who.kind ?? 'npc'}:${who.id}`;
    let p = points.get(key);
    if (!p) {
      const spot = who.spots[0];
      const pos = spot ? toWorld(spot) : null;
      if (!spot || !pos) return;
      p = { key, name: who.name, spot, pos, givers: new Set(), enders: new Set() };
      points.set(key, p);
    }
    p[role].add(questId);
  };
  for (const q of atlas.quests.values()) {
    add(q.giver, q.id, 'givers');
    add(q.ender, q.id, 'enders');
  }

  // Union-find over the points; distance() is Infinity across continents, so those never link.
  const pts = [...points.values()];
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      if (distance(pts[i]!.pos, pts[j]!.pos) <= HUB_LINK) {
        const a = find(i);
        const b = find(j);
        // The earlier point stays the root, so a hub is named after its first NPC.
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }

  const groups = new Map<number, Point[]>();
  pts.forEach((p, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(p);
    else groups.set(root, [p]);
  });

  const byNumber = (a: number, b: number) => a - b;
  const taken = new Set<number>();
  // Ids are given in order of each hub's smallest key, so a (rare) hash collision resolves the same way every time.
  const ordered = [...groups.values()]
    .map((members) => ({ members, min: members.map((m) => m.key).sort()[0]! }))
    .sort((a, b) => (a.min < b.min ? -1 : a.min > b.min ? 1 : 0));
  const ids = new Map<Point[], number>();
  for (const { members, min } of ordered) {
    let id = hashKey(min);
    while (taken.has(id)) id = (id % 0x7fffffff) + 1;
    taken.add(id);
    ids.set(members, id);
  }

  return [...groups.values()].map((members) => {
    const first = members[0]!;
    const pos: WorldPos = {
      continent: first.pos.continent,
      x: members.reduce((s, m) => s + m.pos.x, 0) / members.length,
      y: members.reduce((s, m) => s + m.pos.y, 0) / members.length,
    };
    return {
      id: ids.get(members)!,
      pos,
      spot: placeSpot(members, pos),
      name: `near ${first.name}`,
      givers: [...new Set(members.flatMap((m) => [...m.givers]))].sort(byNumber),
      enders: [...new Set(members.flatMap((m) => [...m.enders]))].sort(byNumber),
    };
  });
}

/** FNV-1a, 31 bits, never 0: a small positive integer id from a member key. */
function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 0x7fffffff) + 1;
}

/** The centroid on the largest member map whose bounds contain it; else on the first member's map; else its spot. */
function placeSpot(members: Point[], pos: WorldPos): MapSpot {
  const first = members[0]!;
  const area = (id: number) => {
    const m = mapInfo(id);
    return m ? m.width * m.height : 0;
  };
  const maps = [...new Set(members.map((m) => m.spot.mapId))].sort((a, b) => area(b) - area(a));
  for (const id of maps) {
    const s = fromWorld(id, pos);
    if (s && s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100) return s;
  }
  return fromWorld(first.spot.mapId, pos) ?? first.spot;
}
