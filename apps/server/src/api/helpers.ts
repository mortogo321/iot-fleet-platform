import type { Context } from 'hono';

/** Parses the JSON body; malformed JSON resolves to `undefined` rather than throwing. */
export async function parseJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export const badRequest = (c: Context, message: string) => c.json({ error: message }, 400);
export const unauthorized = (c: Context, message = 'unauthorized') =>
  c.json({ error: message }, 401);
export const notFound = (c: Context, message = 'not found') => c.json({ error: message }, 404);
export const conflict = (c: Context, message: string) => c.json({ error: message }, 409);
export const gatewayTimeout = (c: Context, message: string) => c.json({ error: message }, 504);
export const serverError = (c: Context, message = 'internal server error') =>
  c.json({ error: message }, 500);
