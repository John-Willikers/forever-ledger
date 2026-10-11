/**
 * The quest atlas's Wowhead list pages: which ones to fetch and their URLs, in one place.
 *
 * URL patterns, and the evidence for them (2026-10-08):
 * - Zone lists `https://www.wowhead.com/forever/quests/<continent>/<zone>`: the breadcrumbs (JSON-LD and nav) of the
 *   stored /forever/quest= pages link exactly these (eastern-kingdoms/elwynn-forest, …/dun-morogh, …/tirisfal-glades,
 *   …/westfall, …/undercity, kalimdor/durotar, …/mulgore, …/orgrimmar, …/the-barrens). The other zone slugs follow
 *   Wowhead's Classic ones (`/classic/quests/eastern-kingdoms/hillsbrad-foothills`) and are not confirmed yet.
 * - Class lists `https://www.wowhead.com/forever/quests/classes/<class>`: a search result titled "Forever Warrior
 *   Quests" at /forever/quests/classes/warrior (Classic, TBC and retail use the same `classes/` path).
 * The first fetched list page confirms a pattern: the fetch report's `final_url` / `http_status` (a 404 or a redirect
 * to another path shows up in `fetch_targets.last_status` and `web_snapshots.final_url`).
 */
export const WOWHEAD_FOREVER = 'https://www.wowhead.com/forever';

/** Atlas lists go before everything else on the queue (the addon's own Forever ids are 10). */
export const ATLAS_LIST_PRIORITY = 30;
/** Quest pages a list names: after the lists, low-level (starter) quests first. */
export const ATLAS_QUEST_PRIORITY = 20;
export const ATLAS_STARTER_QUEST_PRIORITY = 25;
/** Quests up to this level count as starter quests. */
export const STARTER_MAX_LEVEL = 10;

/** A quest's Wowhead Forever page: the one place quest page URLs for the queue are built. */
export function questPageUrl(id: number): string {
  return `${WOWHEAD_FOREVER}/quest=${id}`;
}

export function questPagePriority(level: number | undefined): number {
  return level !== undefined && level >= 1 && level <= STARTER_MAX_LEVEL
    ? ATLAS_STARTER_QUEST_PRIORITY
    : ATLAS_QUEST_PRIORITY;
}

export type Continent = 'eastern-kingdoms' | 'kalimdor';

export interface AtlasZone {
  continent: Continent;
  slug: string;
  name: string;
  /** Classic level range, for reading the list; the planner uses real quest levels. */
  levels: [number, number];
  city?: true;
}

/**
 * Zones with quests in levels 1–60 for either faction, Classic's map (1–30 first; 31–60 added 2026-10-11). Not
 * here: Eversong Woods / Ghostlands (TBC, not in Forever's 1.60.1 client), Forever's own zones (ATLAS_FOREVER_ZONES,
 * listed by id; Gilneas is not seen yet), dungeons.
 */
export const ATLAS_ZONES: AtlasZone[] = [
  // Eastern Kingdoms
  { continent: 'eastern-kingdoms', slug: 'elwynn-forest', name: 'Elwynn Forest', levels: [1, 10] },
  { continent: 'eastern-kingdoms', slug: 'dun-morogh', name: 'Dun Morogh', levels: [1, 10] },
  {
    continent: 'eastern-kingdoms',
    slug: 'tirisfal-glades',
    name: 'Tirisfal Glades',
    levels: [1, 10],
  },
  { continent: 'eastern-kingdoms', slug: 'westfall', name: 'Westfall', levels: [10, 20] },
  { continent: 'eastern-kingdoms', slug: 'loch-modan', name: 'Loch Modan', levels: [10, 20] },
  {
    continent: 'eastern-kingdoms',
    slug: 'silverpine-forest',
    name: 'Silverpine Forest',
    levels: [10, 20],
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'redridge-mountains',
    name: 'Redridge Mountains',
    levels: [15, 25],
  },
  { continent: 'eastern-kingdoms', slug: 'duskwood', name: 'Duskwood', levels: [18, 30] },
  { continent: 'eastern-kingdoms', slug: 'wetlands', name: 'Wetlands', levels: [20, 30] },
  {
    continent: 'eastern-kingdoms',
    slug: 'hillsbrad-foothills',
    name: 'Hillsbrad Foothills',
    levels: [20, 30],
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'alterac-mountains',
    name: 'Alterac Mountains',
    levels: [30, 40],
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'arathi-highlands',
    name: 'Arathi Highlands',
    levels: [30, 40],
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'stranglethorn-vale',
    name: 'Stranglethorn Vale',
    levels: [30, 45],
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'stormwind-city',
    name: 'Stormwind City',
    levels: [1, 60],
    city: true,
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'ironforge',
    name: 'Ironforge',
    levels: [1, 60],
    city: true,
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'undercity',
    name: 'Undercity',
    levels: [1, 60],
    city: true,
  },
  // Kalimdor
  { continent: 'kalimdor', slug: 'teldrassil', name: 'Teldrassil', levels: [1, 10] },
  { continent: 'kalimdor', slug: 'durotar', name: 'Durotar', levels: [1, 10] },
  { continent: 'kalimdor', slug: 'mulgore', name: 'Mulgore', levels: [1, 10] },
  { continent: 'kalimdor', slug: 'darkshore', name: 'Darkshore', levels: [10, 20] },
  { continent: 'kalimdor', slug: 'the-barrens', name: 'The Barrens', levels: [10, 25] },
  {
    continent: 'kalimdor',
    slug: 'stonetalon-mountains',
    name: 'Stonetalon Mountains',
    levels: [15, 27],
  },
  { continent: 'kalimdor', slug: 'ashenvale', name: 'Ashenvale', levels: [18, 30] },
  { continent: 'kalimdor', slug: 'thousand-needles', name: 'Thousand Needles', levels: [25, 35] },
  { continent: 'kalimdor', slug: 'desolace', name: 'Desolace', levels: [30, 40] },
  { continent: 'kalimdor', slug: 'darnassus', name: 'Darnassus', levels: [1, 60], city: true },
  { continent: 'kalimdor', slug: 'orgrimmar', name: 'Orgrimmar', levels: [1, 60], city: true },
  {
    continent: 'kalimdor',
    slug: 'thunder-bluff',
    name: 'Thunder Bluff',
    levels: [1, 60],
    city: true,
  },
  // Levels 31–60 (Harlan 2026-10-11: plan past the beta cap of 30 before launch on Nov 4).
  { continent: 'eastern-kingdoms', slug: 'badlands', name: 'Badlands', levels: [35, 45] },
  {
    continent: 'eastern-kingdoms',
    slug: 'swamp-of-sorrows',
    name: 'Swamp of Sorrows',
    levels: [35, 45],
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'the-hinterlands',
    name: 'The Hinterlands',
    levels: [40, 50],
  },
  { continent: 'eastern-kingdoms', slug: 'searing-gorge', name: 'Searing Gorge', levels: [43, 50] },
  { continent: 'eastern-kingdoms', slug: 'blasted-lands', name: 'Blasted Lands', levels: [45, 55] },
  {
    continent: 'eastern-kingdoms',
    slug: 'burning-steppes',
    name: 'Burning Steppes',
    levels: [50, 58],
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'western-plaguelands',
    name: 'Western Plaguelands',
    levels: [51, 58],
  },
  {
    continent: 'eastern-kingdoms',
    slug: 'eastern-plaguelands',
    name: 'Eastern Plaguelands',
    levels: [53, 60],
  },
  { continent: 'eastern-kingdoms', slug: 'deadwind-pass', name: 'Deadwind Pass', levels: [55, 60] },
  { continent: 'kalimdor', slug: 'dustwallow-marsh', name: 'Dustwallow Marsh', levels: [35, 45] },
  { continent: 'kalimdor', slug: 'feralas', name: 'Feralas', levels: [40, 50] },
  { continent: 'kalimdor', slug: 'tanaris', name: 'Tanaris', levels: [40, 50] },
  { continent: 'kalimdor', slug: 'azshara', name: 'Azshara', levels: [45, 55] },
  { continent: 'kalimdor', slug: 'felwood', name: 'Felwood', levels: [48, 55] },
  { continent: 'kalimdor', slug: 'ungoro-crater', name: "Un'Goro Crater", levels: [48, 55] },
  { continent: 'kalimdor', slug: 'moonglade', name: 'Moonglade', levels: [1, 60] },
  { continent: 'kalimdor', slug: 'winterspring', name: 'Winterspring', levels: [53, 60] },
  { continent: 'kalimdor', slug: 'silithus', name: 'Silithus', levels: [55, 60] },
];

/** The 9 Classic classes, by Wowhead slug. */
export const ATLAS_CLASSES = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
] as const;

/**
 * Forever's own zones, by Wowhead zone id. Their slugs are unknown, so they are listed by id
 * (`/forever/quests=<category>.<zoneId>`, the form the stored pages link, e.g. `quests=0.12` for Elwynn Forest).
 * Ids and groups come from the zone filter on stored Forever pages (2026-10-08), which groups zones by continent; the
 * fetch result shows which category URL exists. Quest categories: 0 Eastern Kingdoms, 1 Kalimdor, 6 Battlegrounds,
 * 7 Miscellaneous.
 * - Zephras Isle 16593 (client uiMap 2521/2665, its own continent): in the filter's "Other" group, so 0, 1 and 7.
 *   Likely the High Order Skyborne start area.
 * - Riverglades 16591 (uiMap 2548): in the Eastern Kingdoms group. Levels 36–44 (planning ahead of the cap).
 * - Shen'dralas 16651 (uiMap 2652): in the Kalimdor group.
 * - Darkspear Islands 16606 (uiMap 2524): Wowhead files it under Battlegrounds (with a "Call to Arms: Darkspear
 *   Islands" quest category), not Kalimdor, so 1 and 6; whether it is the troll start zone is not known yet.
 * Not listed: Mount Hyjal (616, Kalimdor group, uiMap 2482): no evidence it has quests at 30 or below.
 */
export const ATLAS_FOREVER_ZONES: { id: number; name: string; categories: number[] }[] = [
  { id: 16593, name: 'Zephras Isle', categories: [0, 1, 7] },
  { id: 16591, name: 'Riverglades', categories: [0] },
  { id: 16651, name: "Shen'dralas", categories: [1] },
  { id: 16606, name: 'Darkspear Islands', categories: [1, 6] },
];

export type AtlasList =
  | { kind: 'zone'; continent: Continent; zone: string }
  | { kind: 'class'; slug: string }
  | { kind: 'zone-id'; category: number; zoneId: number };

/** The one place list URLs are built. */
export function atlasListUrl(list: AtlasList): string {
  if (list.kind === 'zone') return `${WOWHEAD_FOREVER}/quests/${list.continent}/${list.zone}`;
  if (list.kind === 'class') return `${WOWHEAD_FOREVER}/quests/classes/${list.slug}`;
  return `${WOWHEAD_FOREVER}/quests=${list.category}.${list.zoneId}`;
}

/** Every atlas list page, class lists first (they are few and every character needs theirs). */
export function atlasListUrls(): string[] {
  return [
    ...ATLAS_CLASSES.map((slug) => atlasListUrl({ kind: 'class', slug })),
    ...ATLAS_ZONES.map((z) => atlasListUrl({ kind: 'zone', continent: z.continent, zone: z.slug })),
    ...ATLAS_FOREVER_ZONES.flatMap((z) =>
      z.categories.map((category) => atlasListUrl({ kind: 'zone-id', category, zoneId: z.id })),
    ),
  ];
}

/** A Wowhead quest list page (`/forever/quests/…` or the older `/forever/quests=0.12`), not a single quest. */
export function isWowheadQuestList(url: string): boolean {
  return /^\/(?:[a-z-]+\/)?quests(?:\/|=|$)/.test(new URL(url).pathname);
}
