// Pure helpers for the Item page: stat names, the per-build stat table, drop sources, tooltip text.

const FIELD_LABELS: Readonly<Record<string, string>> = {
  ilvl: 'Item level',
  reqLevel: 'Required level',
  sellPrice: 'Sell price',
};

const RESISTANCES = ['Armor', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane'];

const title = (s: string) =>
  s
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** `ITEM_MOD_STRENGTH_SHORT` → `Strength`, `RESISTANCE2_NAME` → `Fire Resistance`; unknown keys as they are. */
export function statLabel(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const mod = /^ITEM_MOD_(.+?)(?:_SHORT|_NAME)?$/.exec(key);
  if (mod) return title(mod[1]!);
  const res = /^RESISTANCE(\d)_NAME$/.exec(key);
  if (res) {
    const n = Number(res[1]);
    return n === 0 ? 'Armor' : `${RESISTANCES[n] ?? `School ${n}`} Resistance`;
  }
  return key;
}

export interface SnapshotLike {
  build: number;
  ilvl: number | null;
  reqLevel: number | null;
  sellPrice: number | null;
  stats: Record<string, number> | null;
}

export interface StatCell {
  value: number | null;
  /** Differs from the previous (older) build's value. */
  changed: boolean;
}

const FIELDS = ['ilvl', 'reqLevel', 'sellPrice'] as const;

/**
 * The stat table: one column per build (oldest first), one row per field (item level, required level, sell price)
 * and per stat seen in any build; a cell is `changed` when it differs from the build before. `changedBuilds` lists
 * builds where anything changed.
 */
export function statMatrix(snapshots: SnapshotLike[]) {
  const sorted = [...snapshots].sort((a, b) => a.build - b.build);
  if (sorted.length === 0) return { builds: [], rows: [], changedBuilds: [] };
  const statKeys = [...new Set(sorted.flatMap((s) => Object.keys(s.stats ?? {})))].sort((a, b) =>
    statLabel(a).localeCompare(statLabel(b)),
  );
  const valueOf = (s: SnapshotLike, key: string): number | null =>
    (FIELDS as readonly string[]).includes(key)
      ? (s[key as (typeof FIELDS)[number]] ?? null)
      : (s.stats?.[key] ?? null);
  const rows = [...FIELDS, ...statKeys].map((key) => ({
    key,
    label: statLabel(key),
    isStat: !(FIELDS as readonly string[]).includes(key),
    cells: sorted.map((s, i): StatCell => {
      const value = valueOf(s, key);
      return { value, changed: i > 0 && value !== valueOf(sorted[i - 1]!, key) };
    }),
  }));
  const changedBuilds = sorted
    .filter((_, i) => rows.some((r) => r.cells[i]!.changed))
    .map((s) => s.build);
  return { builds: sorted.map((s) => s.build), rows, changedBuilds };
}

export interface DropSource {
  build: number;
  npcId: number;
  count: number;
  contributors: number;
}

export interface DropRate {
  build: number;
  npcId: number;
  npcName: string | null;
  corpses: number;
  dropped: number;
  quantity: number | null;
  rate: number | null;
}

/**
 * /v1/items/:id drop sources (every session, legacy totals included) with the rate where corpses were recorded (the
 * admin item route) and the npc's name when known.
 */
export function mergeDropSources(sources: DropSource[], rates: DropRate[]) {
  return sources.map((s) => {
    const r = rates.find((x) => x.build === s.build && x.npcId === s.npcId);
    return {
      build: s.build,
      npcId: s.npcId,
      npcName: r?.npcName ?? null,
      count: s.count,
      contributors: s.contributors,
      corpses: r?.corpses ?? null,
      rate: r?.rate ?? null,
    };
  });
}

/**
 * A tooltip line as plain text: coin atlases (`|A:coin-gold…|a`) become g/s/c, other WoW escape sequences
 * (`|cAARRGGBB…|r` colors, `|H…|h` links, `|T…|t` textures, `|A…|a` atlases) are dropped, `||` is a literal bar, tabs
 * become spaces. The result is rendered as text, never as markup.
 */
export function tooltipText(line: string) {
  return line
    .replace(/\|A:coin-gold[^|]*\|a/gi, 'g')
    .replace(/\|A:coin-silver[^|]*\|a/gi, 's')
    .replace(/\|A:coin-copper[^|]*\|a/gi, 'c')
    .replace(/\|A[^|]*\|a/g, '')
    .replace(/\|T[^|]*\|t/g, '')
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|r/g, '')
    .replace(/\|H[^|]*\|h/g, '')
    .replace(/\|h/g, '')
    .replace(/\|\|/g, '|')
    .replace(/\t/g, ' ')
    .trim();
}
