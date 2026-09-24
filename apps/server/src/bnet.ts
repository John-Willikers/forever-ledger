// Battle.net OAuth2 (authorization code flow, confidential client). No PKCE and no refresh tokens: we only need the
// account id and BattleTag once per login. Never log codes, tokens or the client secret.

export const BNET_AUTHORIZE_URL = 'https://oauth.battle.net/authorize';
export const BNET_TOKEN_URL = 'https://oauth.battle.net/token';
export const BNET_USERINFO_URL = 'https://oauth.battle.net/userinfo';

const TIMEOUT_MS = 10_000;

export interface BnetConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface BnetUser {
  /** Stable account id. */
  sub: string;
  battletag: string;
}

/** Thrown for any Battle.net failure; `message` is safe to log (no codes or tokens). */
export class BnetError extends Error {}

export function authorizeUrl(cfg: BnetConfig, state: string) {
  const url = new URL(BNET_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: 'openid',
    state,
  }).toString();
  return url.toString();
}

/** RFC 6749 §2.3.1: client id and secret are form-encoded before Basic auth. */
const basicAuth = (cfg: BnetConfig) =>
  'Basic ' +
  Buffer.from(
    `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`,
  ).toString('base64');

/** Exchanges the code for an access token, then reads the account id and BattleTag. */
export async function fetchBnetUser(
  cfg: BnetConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BnetUser> {
  let tokenRes: Response;
  try {
    tokenRes = await fetchImpl(BNET_TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: basicAuth(cfg),
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new BnetError('token request failed (network)');
  }
  if (!tokenRes.ok) throw new BnetError(`token request failed (HTTP ${tokenRes.status})`);
  const token = (await tokenRes.json().catch(() => null)) as { access_token?: unknown } | null;
  if (typeof token?.access_token !== 'string' || token.access_token === '') {
    throw new BnetError('token response has no access_token');
  }

  let infoRes: Response;
  try {
    infoRes = await fetchImpl(BNET_USERINFO_URL, {
      headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new BnetError('userinfo request failed (network)');
  }
  if (!infoRes.ok) throw new BnetError(`userinfo request failed (HTTP ${infoRes.status})`);
  const info = (await infoRes.json().catch(() => null)) as {
    sub?: unknown;
    id?: unknown;
    battletag?: unknown;
  } | null;
  const sub =
    typeof info?.sub === 'string' && info.sub !== ''
      ? info.sub
      : typeof info?.id === 'number' && Number.isSafeInteger(info.id)
        ? String(info.id)
        : null;
  const battletag = typeof info?.battletag === 'string' ? info.battletag.trim() : '';
  if (sub === null || battletag === '' || battletag.length > 64 || sub.length > 64) {
    throw new BnetError('userinfo response has no account id or BattleTag');
  }
  return { sub, battletag };
}
