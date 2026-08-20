import { FirmwareInputSchema } from '@iot/shared';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { badRequest, parseJsonBody } from './helpers';

export interface FirmwareDeps {
  pool: Pool;
}

interface FirmwareRow {
  version: string;
  sha256: string;
  size_bytes: string | number;
  notes: string | null;
  created_at: Date;
}

function toApiRow(row: FirmwareRow) {
  return {
    version: row.version,
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes),
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

export function createFirmwareRouter(deps: FirmwareDeps): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const res = await deps.pool.query<FirmwareRow>(
      'SELECT version, sha256, size_bytes, notes, created_at FROM firmware ORDER BY created_at DESC',
    );
    return c.json(res.rows.map(toApiRow));
  });

  app.post('/', async (c) => {
    const raw = await parseJsonBody(c);
    const parsed = FirmwareInputSchema.safeParse(raw);
    if (!parsed.success) return badRequest(c, parsed.error.message);
    const { version, sha256, sizeBytes, notes } = parsed.data;
    const res = await deps.pool.query<FirmwareRow>(
      `INSERT INTO firmware (version, sha256, size_bytes, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (version) DO UPDATE SET sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes, notes = EXCLUDED.notes
       RETURNING version, sha256, size_bytes, notes, created_at`,
      [version, sha256, sizeBytes, notes ?? null],
    );
    const row = res.rows[0];
    if (!row) return badRequest(c, 'firmware upsert failed');
    return c.json(toApiRow(row), 201);
  });

  return app;
}
