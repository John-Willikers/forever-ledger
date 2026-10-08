// Hand-made atlases for the planner tests: NPCs, objectives and quests on real client maps (so geometry works), and
// spots placed by yards from a base spot.
import { fromWorld, toWorld } from '../src/planner/geo.js';
import type { TravelData } from '../src/planner/travel.js';
import type {
  Atlas,
  AtlasObjective,
  AtlasQuest,
  CharacterState,
  MapSpot,
  QuestPoint,
} from '../src/planner/types.js';

/** `base` moved `north` and `west` yards (negative = south / east), on base's map. */
export function offset(base: MapSpot, north: number, west = 0): MapSpot {
  const w = toWorld(base)!;
  return fromWorld(base.mapId, { continent: w.continent, x: w.x + north, y: w.y + west })!;
}

export const npc = (id: number, name: string, spot: MapSpot): QuestPoint => ({
  id,
  name,
  spots: [spot],
});

type Obj = Omit<AtlasObjective, 'index'>;
export const kill = (spots: MapSpot[], count = 5, text = 'Mob slain'): Obj => ({
  kind: 'kill',
  text: `${text}: ${count}`,
  count,
  spots,
});
export const collect = (spots: MapSpot[], count = 5, text = 'Thing'): Obj => ({
  kind: 'collect',
  text: `${text}: ${count}`,
  count,
  spots,
});

export interface QuestOpts extends Partial<Omit<AtlasQuest, 'objectives'>> {
  objectives?: Obj[];
}

export function quest(id: number, o: QuestOpts = {}): AtlasQuest {
  const { objectives = [], ...rest } = o;
  return {
    id,
    title: `Quest ${id}`,
    level: 5,
    reqLevel: 1,
    side: 'Horde',
    classes: null,
    races: null,
    giver: null,
    ender: null,
    prereqs: [],
    xp: 300,
    ...rest,
    objectives: objectives.map((ob, index) => ({ index, ...ob })),
  };
}

export const atlas = (qs: AtlasQuest[]): Atlas => ({ quests: new Map(qs.map((q) => [q.id, q])) });

export const character = (over: Partial<CharacterState> = {}): CharacterState => ({
  level: 5,
  xp: 0,
  className: 'WARRIOR',
  race: 'Orc',
  faction: 'Horde',
  completed: new Set(),
  log: new Map(),
  position: { mapId: 1413, x: 50, y: 30 },
  flightPaths: new Set(),
  hearth: null,
  mounted: false,
  ...over,
});

export const NO_TRAVEL: TravelData = { flightNodes: [], transports: [] };
