// Request logging without secrets: OAuth codes/states and tokens can arrive in query strings.

const SECRET_PARAMS = new Set(['code', 'state', 'token', 'access_token', 'id_token']);

/** The URL with the values of secret-bearing query parameters replaced. */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let changed = false;
  for (const key of new Set(params.keys())) {
    if (SECRET_PARAMS.has(key.toLowerCase())) {
      params.set(key, 'redacted');
      changed = true;
    }
  }
  return changed ? `${url.slice(0, q)}?${params.toString()}` : url;
}

interface LoggedRequest {
  method: string;
  url: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number } | null;
}

/** pino serializer for Fastify requests (the default one, minus secrets in the URL). */
export function serializeRequest(req: LoggedRequest) {
  return {
    method: req.method,
    url: redactUrl(req.url),
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
