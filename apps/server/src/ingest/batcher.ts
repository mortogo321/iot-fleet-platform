import { LIMITS } from '@iot/shared';
import { logger } from '../log';

export interface Batcher<T> {
  push(row: T): void;
  /** Force a flush now; resolves once the in-flight writer call (if any) settles. */
  flush(): Promise<void>;
  /** Flush remaining rows and stop; safe to call once during shutdown. */
  stop(): Promise<void>;
  droppedCount(): number;
  size(): number;
}

export interface BatcherDeps<T> {
  writer: (rows: T[]) => Promise<void>;
  maxRows?: number;
  flushMs?: number;
  bufferCap?: number;
  /** Injectable clock, used only for flush-duration timing. */
  clock?: () => number;
  onDropped?: (droppedNow: number) => void;
  onFlush?: (durationSeconds: number, rowCount: number) => void;
  onError?: (err: unknown) => void;
}

/**
 * Generic bounded batcher: flushes at `maxRows` or `flushMs`, whichever comes first.
 * Oldest rows are dropped (and counted) once `bufferCap` is exceeded.
 */
export function createBatcher<T>(deps: BatcherDeps<T>): Batcher<T> {
  const maxRows = deps.maxRows ?? LIMITS.BATCH_MAX_ROWS;
  const flushMs = deps.flushMs ?? LIMITS.BATCH_FLUSH_MS;
  const bufferCap = deps.bufferCap ?? LIMITS.BATCH_BUFFER_CAP;
  const clock = deps.clock ?? Date.now;

  let buffer: T[] = [];
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function doFlush(): Promise<void> {
    clearTimer();
    if (buffer.length === 0) return pending;
    const rows = buffer;
    buffer = [];
    const start = clock();
    const task = deps
      .writer(rows)
      .then(() => {
        deps.onFlush?.((clock() - start) / 1000, rows.length);
      })
      .catch((err: unknown) => {
        logger.error('batch flush failed', err);
        deps.onError?.(err);
      });
    pending = pending.then(() => task);
    return pending;
  }

  function push(row: T): void {
    if (buffer.length >= bufferCap) {
      buffer.shift();
      dropped += 1;
      deps.onDropped?.(1);
    }
    buffer.push(row);
    if (buffer.length >= maxRows) {
      void doFlush();
      return;
    }
    if (timer === undefined) {
      timer = setTimeout(() => void doFlush(), flushMs);
      timer.unref?.();
    }
  }

  return {
    push,
    flush: doFlush,
    stop: () => doFlush(),
    droppedCount: () => dropped,
    size: () => buffer.length,
  };
}
