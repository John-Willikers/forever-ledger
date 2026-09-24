import type { FastifyInstance } from 'fastify';
import type { AdminGuards } from './adminAuth.js';

/** JSON routes for the admin panel; everything under /admin/api needs an admin session (+ CSRF on writes). */
export function registerAdminApiRoutes(app: FastifyInstance, guards: AdminGuards) {
  const preHandler = guards.requireAdmin;

  /** Proves the guard: who am I, as the admin API sees it. POST checks the CSRF header. */
  const ping = async (
    req: Parameters<AdminGuards['session']>[0],
    reply: Parameters<AdminGuards['session']>[1],
  ) => {
    const s = await guards.session(req, reply);
    return { ok: true, user: s?.user ?? null };
  };
  app.get('/admin/api/ping', { preHandler }, ping);
  app.post('/admin/api/ping', { preHandler }, ping);
}
