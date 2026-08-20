import { Hono } from 'hono';

export interface HealthDeps {
  pingDb: () => Promise<boolean>;
}

export function createHealthRouter(deps: HealthDeps): Hono {
  const app = new Hono();
  app.get('/', async (c) => {
    const dbOk = await deps.pingDb();
    if (!dbOk) return c.json({ ok: false, db: false }, 503);
    return c.json({ ok: true, db: true });
  });
  return app;
}
