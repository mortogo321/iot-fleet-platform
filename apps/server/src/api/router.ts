import { existsSync } from 'node:fs';
import type { PlatformStats } from '@iot/shared';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { logger } from '../log';
import { registry } from '../metrics';
import { type AlertsDeps, createAlertsRouter } from './alerts';
import { createDevicesRouter, type DevicesDeps } from './devices';
import { createFirmwareRouter, type FirmwareDeps } from './firmware';
import { createHealthRouter, type HealthDeps } from './health';
import { createIngestRouter, type IngestRouterDeps } from './ingest';
import { createInternalRouter, type InternalDeps } from './internal';
import { createRulesRouter, type RulesDeps } from './rules';
import { createStatsRouter } from './stats';

export interface RouterDeps {
  health: HealthDeps;
  statsProvider: { getStats(): Promise<PlatformStats> };
  internal: InternalDeps;
  ingest: IngestRouterDeps;
  devices: DevicesDeps;
  firmware: FirmwareDeps;
  alerts: AlertsDeps;
  rules: RulesDeps;
  /** apps/web/dist — served with SPA fallback when present; omitted (or missing) in dev/tests. */
  webDistPath?: string;
}

export function createApp(deps: RouterDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    logger.error('unhandled request error', err);
    return c.json({ error: 'internal server error' }, 500);
  });

  app.route('/health', createHealthRouter(deps.health));

  app.get('/metrics', async () => {
    const body = await registry.metrics();
    return new Response(body, { status: 200, headers: { 'content-type': registry.contentType } });
  });

  const api = new Hono();
  api.route('/devices', createDevicesRouter(deps.devices));
  api.route('/firmware', createFirmwareRouter(deps.firmware));
  api.route('/alerts', createAlertsRouter(deps.alerts));
  api.route('/rules', createRulesRouter(deps.rules));
  api.route('/ingest', createIngestRouter(deps.ingest));
  api.route('/internal/mqtt', createInternalRouter(deps.internal));
  api.route('/stats', createStatsRouter(deps.statsProvider));
  app.route('/api', api);

  if (deps.webDistPath && existsSync(deps.webDistPath)) {
    const root = deps.webDistPath;
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ path: 'index.html', root }));
  }

  return app;
}
