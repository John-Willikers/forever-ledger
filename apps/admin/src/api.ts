import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';

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

/** A non-2xx answer from the API; `message` is the server's `{ error }` text when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The session is gone (or never was): the shell shows the login page after /me is re-read. */
  get unauthenticated() {
    return this.status === 401;
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

/**
 * PUT/DELETE (or any non-GET) with the CSRF header and an optional raw body (a File for uploads, sent as-is with its
 * content type); resolves to the JSON body, or null for 204.
 */
export async function sendWithCsrf<T>(
  method: 'PUT' | 'DELETE' | 'POST',
  path: string,
  csrf: string | null,
  body?: Blob,
): Promise<T | null> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body ? { 'content-type': body.type || 'application/octet-stream' } : {}),
    },
    body,
  });
  if (!res.ok) throw await errorOf(res);
  return res.status === 204 ? null : ((await res.json()) as T);
}

export const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => getJson<Me>('/admin/auth/me') });
}

export const logout = (csrf: string | null) => postJson('/admin/auth/logout', csrf);

/** The CSRF token from /admin/auth/me (already loaded by the shell), for writes. */
export function useCsrf(): string | null {
  const queryClient = useQueryClient();
  return queryClient.getQueryData<Me>(ME_KEY)?.csrf ?? null;
}

/**
 * GET an admin JSON route with TanStack Query. A 401 means the session ended: /me is re-read so the shell swaps to the
 * login page instead of showing an error on every card.
 */
export function useAdminQuery<T>(
  key: QueryKey,
  path: string,
  options: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'> = {},
) {
  const queryClient = useQueryClient();
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: async () => {
      try {
        return await getJson<T>(path);
      } catch (err) {
        if (err instanceof ApiError && err.unauthenticated)
          void queryClient.invalidateQueries({ queryKey: ME_KEY });
        throw err;
      }
    },
    ...options,
  });
}

/** Full-page navigation: Battle.net's login page can't be fetched. */
export const LOGIN_URL = '/admin/auth/login';
