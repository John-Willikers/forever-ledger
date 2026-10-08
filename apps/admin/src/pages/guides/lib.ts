import type { GuideForm, GuideStep } from './types';

export const ACTION_LABELS: Record<GuideStep['action'], string> = {
  accept: 'Accept',
  complete: 'Do',
  turn_in: 'Turn in',
  travel: 'Travel',
};

const HOW_LABELS: Record<NonNullable<GuideStep['how']>, string> = {
  walk: 'Go',
  fly: 'Fly',
  boat: 'Take the boat',
  hearth: 'Hearth',
};

/** What a step does: "Turn in → 12", "Fly (Orgrimmar → Crossroads)", "Accept (class quest)". */
export function stepDo(s: GuideStep): string {
  const what = s.action === 'travel' && s.how ? HOW_LABELS[s.how] : ACTION_LABELS[s.action];
  const after = s.levelAfter ? ` → ${s.levelAfter}` : '';
  return `${what}${after}${s.note ? ` (${s.note})` : ''}`;
}

const level = (s: string) => {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 1 && n <= 80 ? n : null;
};

/** The request body for a guide, or what's wrong with the form. */
export function guideRequest(
  f: GuideForm,
): { ok: true; body: Record<string, unknown> } | { ok: false; problem: string } {
  const character = f.character.trim();
  if (!character) return { ok: false, problem: 'Name the character the guide is for.' };
  const toLevel = level(f.toLevel);
  if (toLevel === null || toLevel < 2) return { ok: false, problem: 'To level must be 2-80.' };
  const fromLevel = f.fromLevel.trim() ? level(f.fromLevel) : undefined;
  if (fromLevel === null) return { ok: false, problem: 'From level must be 1-80, or empty.' };
  if (fromLevel !== undefined && fromLevel >= toLevel)
    return { ok: false, problem: 'From level must be below to level.' };
  return {
    ok: true,
    body: {
      character,
      ...(f.start.trim() ? { start: f.start.trim() } : {}),
      ...(f.basedOn.trim() ? { basedOn: f.basedOn.trim() } : {}),
      toLevel,
      ...(fromLevel !== undefined ? { fromLevel } : {}),
    },
  };
}

/** Where a step happens: NPC, subzone and zone, and coordinates. */
export function stepPlace(s: GuideStep): string {
  const where = [s.npc, s.subzone, s.zone].filter(Boolean).join(' · ');
  const at = s.x !== null && s.y !== null ? ` (${s.x.toFixed(1)}, ${s.y.toFixed(1)})` : '';
  return `${where || '—'}${at}`;
}

/** The character's name without the realm. */
export const charName = (key: string) => key.replace(/-[^-]*$/, '');
