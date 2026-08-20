import { describe, expect, test } from 'bun:test';
import { createBatcher } from '../src/ingest/batcher';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createBatcher', () => {
  test('flushes when maxRows is reached', async () => {
    const calls: string[][] = [];
    const batcher = createBatcher<string>({
      writer: async (rows) => {
        calls.push(rows);
      },
      maxRows: 3,
      flushMs: 100_000,
      bufferCap: 100,
    });

    batcher.push('a');
    batcher.push('b');
    batcher.push('c');
    await batcher.flush();

    expect(calls).toEqual([['a', 'b', 'c']]);
    expect(batcher.size()).toBe(0);
  });

  test('flushes on the timer even without reaching maxRows', async () => {
    const calls: string[][] = [];
    const batcher = createBatcher<string>({
      writer: async (rows) => {
        calls.push(rows);
      },
      maxRows: 100,
      flushMs: 20,
      bufferCap: 100,
    });

    batcher.push('only-one');
    expect(calls).toEqual([]); // not yet — waiting on the timer

    await sleep(60);

    expect(calls).toEqual([['only-one']]);
  });

  test('drops the oldest row and counts drops once bufferCap is exceeded', async () => {
    const calls: string[][] = [];
    const batcher = createBatcher<string>({
      writer: async (rows) => {
        calls.push(rows);
      },
      maxRows: 100,
      flushMs: 100_000,
      bufferCap: 2,
    });

    batcher.push('a');
    batcher.push('b');
    batcher.push('c'); // drops 'a'
    expect(batcher.droppedCount()).toBe(1);

    batcher.push('d'); // drops 'b'
    expect(batcher.droppedCount()).toBe(2);
    expect(batcher.size()).toBe(2);

    await batcher.flush();
    expect(calls).toEqual([['c', 'd']]);
  });

  test('calls onDropped once per dropped row', () => {
    let dropped = 0;
    const batcher = createBatcher<string>({
      writer: async () => {},
      maxRows: 100,
      flushMs: 100_000,
      bufferCap: 1,
      onDropped: (n) => {
        dropped += n;
      },
    });

    batcher.push('a');
    batcher.push('b'); // drops 'a'
    batcher.push('c'); // drops 'b'

    expect(dropped).toBe(2);
  });

  test('flush() awaits the in-flight writer (shutdown semantics)', async () => {
    let resolveWriter: (() => void) | undefined;
    const writerStarted = new Promise<void>((resolve) => {
      resolveWriter = resolve;
    });
    let writerFinished = false;

    const batcher = createBatcher<string>({
      writer: async () => {
        resolveWriter?.();
        await sleep(30);
        writerFinished = true;
      },
      maxRows: 1,
      flushMs: 100_000,
      bufferCap: 100,
    });

    batcher.push('a'); // triggers an immediate flush (maxRows === 1)
    await writerStarted;
    expect(writerFinished).toBe(false);

    await batcher.stop();
    expect(writerFinished).toBe(true);
  });

  test('uses the injectable clock to time the flush duration', async () => {
    let now = 1_000;
    const clock = () => now;
    const durations: number[] = [];

    const batcher = createBatcher<string>({
      writer: async () => {
        now += 500; // simulate 500ms of work
      },
      maxRows: 1,
      flushMs: 100_000,
      bufferCap: 100,
      clock,
      onFlush: (seconds) => durations.push(seconds),
    });

    batcher.push('a');
    await batcher.flush();

    expect(durations).toEqual([0.5]);
  });
});
