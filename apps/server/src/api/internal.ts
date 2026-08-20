import { timingSafeEqual } from 'node:crypto';
import { MqttAclRequestSchema, MqttAuthRequestSchema } from '@iot/shared';
import { Hono } from 'hono';
import { logger } from '../log';
import { checkAcl } from '../mqtt/acl';
import { parseJsonBody, unauthorized } from './helpers';

export interface InternalDeps {
  internalToken: string;
  serverUsername: string;
  serverPassword: string;
  findDeviceSecretHash: (deviceId: string) => Promise<string | null>;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createInternalRouter(deps: InternalDeps): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const token = c.req.header('x-internal-token');
    if (!token || !safeCompare(token, deps.internalToken)) {
      return unauthorized(c);
    }
    await next();
  });

  // EMQX HTTP authenticator: always 200 with a result body, never a raw error.
  app.post('/auth', async (c) => {
    const raw = await parseJsonBody(c);
    const parsed = MqttAuthRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json({ result: 'deny' });
    const { clientid, username, password } = parsed.data;

    if (username === deps.serverUsername) {
      return safeCompare(password, deps.serverPassword)
        ? c.json({ result: 'allow', is_superuser: true })
        : c.json({ result: 'deny' });
    }

    if (clientid !== username) return c.json({ result: 'deny' });

    try {
      const hash = await deps.findDeviceSecretHash(username);
      if (!hash) return c.json({ result: 'deny' });
      const ok = await Bun.password.verify(password, hash);
      return c.json(ok ? { result: 'allow', is_superuser: false } : { result: 'deny' });
    } catch (err) {
      logger.error('mqtt auth check failed', err);
      return c.json({ result: 'deny' });
    }
  });

  // EMQX HTTP authorizer: always 200 with a result body.
  app.post('/acl', async (c) => {
    const raw = await parseJsonBody(c);
    const parsed = MqttAclRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json({ result: 'deny' });
    const { username, action, topic } = parsed.data;
    return c.json({ result: checkAcl(username, action, topic) ? 'allow' : 'deny' });
  });

  return app;
}
