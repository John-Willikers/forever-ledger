/** The server's `?error=` codes after a failed Battle.net login, each with a fixed message. */
export const LOGIN_ERRORS = {
  state: 'Your login expired or was started elsewhere. Please try again.',
  cancelled: 'Battle.net login was cancelled.',
  failed: 'Battle.net login failed. Please try again.',
  unauthorized: 'This Battle.net account is not allowed to log in.',
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

/**
 * The message for the `?error=` code in the query string. Unknown values show nothing: the text never comes from
 * the URL, so a crafted link can't put words in the panel's mouth.
 */
export function loginError(search: string | URLSearchParams): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const code = params.get('error');
  return code !== null && Object.hasOwn(LOGIN_ERRORS, code)
    ? LOGIN_ERRORS[code as LoginErrorCode]
    : null;
}
