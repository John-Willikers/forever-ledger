// WoW class colors (the game's RAID_CLASS_COLORS), keyed by the class file name the addon reports.
export const CLASS_COLORS: Readonly<Record<string, string>> = {
  WARRIOR: '#C69B6D',
  PALADIN: '#F48CBA',
  HUNTER: '#AAD372',
  ROGUE: '#FFF468',
  PRIEST: '#FFFFFF',
  DEATHKNIGHT: '#C41E3A',
  SHAMAN: '#0070DD',
  MAGE: '#3FC7EB',
  WARLOCK: '#8788EE',
  MONK: '#00FF98',
  DRUID: '#FF7C0A',
  DEMONHUNTER: '#A330C9',
  EVOKER: '#33937F',
};

const UNKNOWN = '#9AA4B2';

const LABELS: Readonly<Record<string, string>> = {
  DEATHKNIGHT: 'Death Knight',
  DEMONHUNTER: 'Demon Hunter',
};

const key = (cls: string | null | undefined) => (cls ?? '').toUpperCase().replace(/[\s_]/g, '');

export const classColor = (cls: string | null | undefined) => CLASS_COLORS[key(cls)] ?? UNKNOWN;

/** `HUNTER` → `Hunter`, `DEATHKNIGHT` → `Death Knight`; unknown when missing. */
export function classLabel(cls: string | null | undefined) {
  const k = key(cls);
  if (!k) return 'Unknown class';
  return LABELS[k] ?? k.charAt(0) + k.slice(1).toLowerCase();
}

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function textOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#000000';
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Contrast with black (l + 0.05) / 0.05 vs with white 1.05 / (l + 0.05): black wins above l ≈ 0.179.
  return l > 0.179 ? '#000000' : '#FFFFFF';
}
