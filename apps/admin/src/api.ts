import { useQuery } from '@tanstack/react-query';

export type Role = 'admin' | 'member';

export interface User {
  id: number;
  battletag: string;
  role: Role;
}

export interface Me {
  user: User | null;
  /** Send as `x-csrf-token` on every non-GET request. */
  csrf: string | null;
  /** False until the server has a Battle.net client. */
  loginConfigured: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function errorOf(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return new ApiError(
    res.status,
    typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`,
  );
}

/** GET a JSON route with the session cookie (/v1/* or /admin/api/*). */
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/** POST with the CSRF header; resolves to the JSON body, or null for 204. */
export async function postJson<T>(
  path: string,
  csrf: string | null,
  body?: unknown,
): Promise<T | null> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await errorOf(res);
  return res.status === 204 ? null : ((await res.json()) as T);
}

export const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => getJson<Me>('/admin/auth/me') });
}

export const logout = (csrf: string | null) => postJson('/admin/auth/logout', csrf);

/** Full-page navigation: Battle.net's login page can't be fetched. */
export const LOGIN_URL = '/admin/auth/login';
