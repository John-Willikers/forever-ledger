// Pure helpers for the Access page.
import type { AdminUser, Token } from '../types';

/** The last admin can't be demoted (the server answers 409); the UI disables that button. */
export const isLastAdmin = (users: AdminUser[], id: number) =>
  users.some((u) => u.id === id && u.role === 'admin') &&
  users.filter((u) => u.role === 'admin').length === 1;

/** Active tokens first (newest first), then revoked ones. */
export function sortTokens(tokens: Token[]) {
  return [...tokens].sort(
    (a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || b.id - a.id,
  );
}

export const TOKEN_LABEL_MAX = 100;

/** A problem with a label, or null when it can be minted. */
export function labelProblem(label: string) {
  const t = label.trim();
  if (!t) return 'Give the token a label (whose PC is it?).';
  if (t.length > TOKEN_LABEL_MAX) return `Keep the label under ${TOKEN_LABEL_MAX} characters.`;
  return null;
}
