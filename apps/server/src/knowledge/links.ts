// Wowhead links for answers: every item, NPC, quest, object and spell an answer names gets the URL of its Wowhead
// Forever page, built here from the id (never by a model), so a bot can show names as links.
const WOWHEAD = 'https://www.wowhead.com/forever';

export type LinkType = 'item' | 'npc' | 'quest' | 'object' | 'spell';
const LINK_TYPES = new Set<string>(['item', 'npc', 'quest', 'object', 'spell']);

/** `itemId` → an `itemUrl` beside it, and so on (a container is an item, a node is a game object). */
const ID_KEYS: Record<string, { type: LinkType; urlKey: string }> = {
  itemId: { type: 'item', urlKey: 'itemUrl' },
  npcId: { type: 'npc', urlKey: 'npcUrl' },
  questId: { type: 'quest', urlKey: 'questUrl' },
  containerId: { type: 'item', urlKey: 'containerUrl' },
  objectId: { type: 'object', urlKey: 'objectUrl' },
};

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** The Wowhead Forever page of a game entity, or null for an id that has none (0, negative, unknown type). */
export function wowheadUrl(type: string, id: unknown): string | null {
  return LINK_TYPES.has(type) && isId(id) ? `${WOWHEAD}/${type}=${id}` : null;
}

/**
 * A copy of an answer with Wowhead links added: `{ itemId: 7973 }` gains `itemUrl`, `{ npcId }` gains `npcUrl` (and
 * questId, containerId, objectId the same), and an entity `{ type: 'npc', id: 2505 }` (search hits, claim entities,
 * "dropped by" values) gains `url`. Existing fields are never changed; zones are left alone (the addon's map ids are
 * not Wowhead's zone ids).
 */
export function withWowheadLinks<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withWowheadLinks(v)) as T;
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) out[k] = withWowheadLinks(v);
  for (const [key, { type, urlKey }] of Object.entries(ID_KEYS)) {
    if (urlKey in src) continue;
    const url = wowheadUrl(type, src[key]);
    if (url) out[urlKey] = url;
  }
  if (!('url' in src) && typeof src.type === 'string') {
    const url = wowheadUrl(src.type, src.id);
    if (url) out.url = url;
  }
  return out as T;
}
