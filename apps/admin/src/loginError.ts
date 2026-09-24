const MAX_LENGTH = 200;

/** The server's `?error=` message after a failed Battle.net login (rendered as text, never HTML). */
export function loginError(search: string | URLSearchParams): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const message = params.get('error')?.trim();
  return message ? message.slice(0, MAX_LENGTH) : null;
}
