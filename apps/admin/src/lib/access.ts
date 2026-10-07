// Pure helpers for the Access page.
import type { AdminUser, Token, TokenHelper } from '../types';

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

/** What a token's read scope unlocks: every /v1 read route, i.e. everyone's data and error reports. */
export const READ_SCOPE_LABEL = 'can read all data (API/export)';

/** The read-scope toggle for a token: what it switches to, its button, and the inline confirm. */
export function readToggle(t: Pick<Token, 'canRead' | 'label'>) {
  return t.canRead
    ? {
        next: false,
        button: 'Make upload only',
        confirm: `Take back read access from "${t.label}"`,
        danger: false,
      }
    : {
        next: true,
        button: 'Allow reading',
        confirm: `Let "${t.label}" read all data (API/export)`,
        danger: true,
      };
}

/** A helper's next action: approve a pending one, pause an approved one, resume a paused one. */
export function helperAction(h: Pick<TokenHelper, 'status'>) {
  if (h.status === 'approved')
    return { next: 'paused' as const, button: 'Pause', confirm: 'Pause this helper' };
  return {
    next: 'approved' as const,
    button: h.status === 'pending' ? 'Approve' : 'Resume',
    confirm: h.status === 'pending' ? 'Let this tray fetch Wowhead pages' : 'Resume fetching',
  };
}

/** Helpers waiting for approval, for the callout above the tokens table. */
export const pendingHelpers = (tokens: Token[]) =>
  tokens.filter((t) => !t.revokedAt && t.helper?.status === 'pending');
