// Serves the built admin SPA (apps/admin/dist) at /admin/, with index.html for client-side routes.
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** apps/admin/dist; resolves the same from src/routes (dev) and dist/routes (built). */
export const DEFAULT_ADMIN_DIST_DIR = fileURLToPath(
  new URL('../../../admin/dist', import.meta.url),
);

/** JSON namespaces under /admin (private, never cached, never the SPA). */
const API_PATH = /^\/admin\/(api|auth)(\/|$)/;
/** Server paths under /admin that never fall back to the SPA: the JSON namespaces and zone map images. The Maps page
 * itself (/admin/maps) is a client route. */
const SERVER_PATH = /^\/admin\/((api|auth)(\/|$)|maps\/)/;

const pathOf = (url: string) => url.split('?', 1)[0]!;

/** /admin/api or /admin/auth, judged on the path alone (a query string must not change the answer). */
export const isAdminApiPath = (url: string) => API_PATH.test(pathOf(url));

/** /admin/api, /admin/auth or /admin/maps/…: answered by the server (JSON 404 when unknown), never by the SPA. */
export const isAdminServerPath = (url: string) => SERVER_PATH.test(pathOf(url));

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'content-security-policy':
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

export async function registerAdminStatic(app: FastifyInstance, distDir = DEFAULT_ADMIN_DIST_DIR) {
  // Checked once at startup: rebuild the panel, then restart the API.
  const built = existsSync(join(distDir, 'index.html'));

  app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));

  await app.register(
    async (scope) => {
      scope.addHook('onSend', async (req, reply) => {
        if (!isAdminServerPath(req.url)) reply.headers(SECURITY_HEADERS);
      });
      if (built) {
        await scope.register(fastifyStatic, {
          root: distDir,
          prefix: '/',
          cacheControl: false,
          // The default is 'allow': never serve .env, .git or other dotfiles that end up in the build directory.
          dotfiles: 'deny',
          // Vite's hashed bundles never change; everything else is revalidated.
          setHeaders: (reply, path) => {
            reply.header(
              'cache-control',
              path.includes(`${sep}assets${sep}`)
                ? 'public, max-age=31536000, immutable'
                : 'no-cache',
            );
          },
        });
      }
      scope.setNotFoundHandler(async (req, reply) => {
        if (isAdminServerPath(req.url) || (req.method !== 'GET' && req.method !== 'HEAD')) {
          return reply.status(404).send({ error: 'not found' });
        }
        if (!built) return reply.status(503).type('text/plain').send('admin panel not built');
        return reply.header('cache-control', 'no-cache').sendFile('index.html');
      });
    },
    { prefix: '/admin' },
  );
}
