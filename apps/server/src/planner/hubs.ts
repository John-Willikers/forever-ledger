// Planner hubs: the places a player stops at to pick up and hand in quests. Every quest giver and ender (its first
// spot) is a point; points within HUB_LINK yards of each other on one continent are linked (single-link clustering), and
// each connected group is a hub at the centroid of its NPCs. Pure.
import { distance, fromWorld, toWorld } from './geo.js';
import type { Atlas, MapSpot, WorldPos } from './types.js';

export interface Hub {
  id: number;
  pos: WorldPos;
  /** The centroid on the first NPC's map (that NPC's own spot if the centroid cannot be placed there). */
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
  name: string;
  spot: MapSpot;
  pos: WorldPos;
  givers: Set<number>;
  enders: Set<number>;
}

export function buildHubs(atlas: Atlas): Hub[] {
  // One point per NPC, in the order the atlas first names it.
  const points = new Map<number, Point>();
  const add = (
    who: { id: number; name: string; spots: MapSpot[] } | null,
    questId: number,
    role: 'givers' | 'enders',
  ) => {
    if (!who) return;
    let p = points.get(who.id);
    if (!p) {
      const spot = who.spots[0];
      const pos = spot ? toWorld(spot) : null;
      if (!spot || !pos) return;
      p = { name: who.name, spot, pos, givers: new Set(), enders: new Set() };
      points.set(who.id, p);
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
  return [...groups.values()].map((members, k) => {
    const first = members[0]!;
    const pos: WorldPos = {
      continent: first.pos.continent,
      x: members.reduce((s, m) => s + m.pos.x, 0) / members.length,
      y: members.reduce((s, m) => s + m.pos.y, 0) / members.length,
    };
    return {
      id: k + 1,
      pos,
      spot: fromWorld(first.spot.mapId, pos) ?? first.spot,
      name: `near ${first.name}`,
      givers: [...new Set(members.flatMap((m) => [...m.givers]))].sort(byNumber),
      enders: [...new Set(members.flatMap((m) => [...m.enders]))].sort(byNumber),
    };
  });
}
