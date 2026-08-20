import { describe, expect, it } from 'bun:test';
import { OtaProgressSchema } from '@iot/shared';
import { runOtaSequence } from '../src/ota';

describe('runOtaSequence', () => {
  it('emits a valid, correctly-ordered phase sequence with injected sleep/clock', async () => {
    let simulatedClockMs = 0;
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
      simulatedClockMs += ms;
    };
    // Fixed rng => deterministic download step count: 4 + floor(0.5 * 3) = 5 steps.
    const rng = () => 0.5;

    const events = [];
    for await (const event of runOtaSequence('2.0.0', { sleep, rng })) {
      events.push(event);
    }

    for (const event of events) {
      expect(OtaProgressSchema.safeParse(event).success).toBe(true);
      expect(event.version).toBe('2.0.0');
    }

    const downloading = events.filter((e) => e.phase === 'downloading');
    expect(downloading.length).toBe(5);
    expect(downloading.map((e) => e.progress)).toEqual([20, 40, 60, 80, 100]);
    // Progress must be non-decreasing across the download phase.
    for (let i = 1; i < downloading.length; i++) {
      const prev = downloading[i - 1];
      const curr = downloading[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      if (prev && curr) expect(curr.progress).toBeGreaterThanOrEqual(prev.progress);
    }

    const phaseOrder = events.map((e) => e.phase);
    expect(phaseOrder).toEqual([
      'downloading',
      'downloading',
      'downloading',
      'downloading',
      'downloading',
      'verifying',
      'applying',
      'rebooting',
      'complete',
    ]);

    // Injected clock actually advanced — proves sleep is used, not skipped.
    expect(simulatedClockMs).toBeGreaterThan(0);
    expect(sleepCalls.length).toBeGreaterThan(0);
  });

  it('supports 4 and 6-step download boundaries via rng', async () => {
    const sleep = async () => undefined;

    const minEvents = [];
    for await (const event of runOtaSequence('1.2.3', { sleep, rng: () => 0 }))
      minEvents.push(event);
    expect(minEvents.filter((e) => e.phase === 'downloading').length).toBe(4);

    const maxEvents = [];
    for await (const event of runOtaSequence('1.2.3', { sleep, rng: () => 0.999 })) {
      maxEvents.push(event);
    }
    expect(maxEvents.filter((e) => e.phase === 'downloading').length).toBe(6);
  });

  it('lets the caller drive the real disconnect/reconnect around the rebooting event', async () => {
    const sleep = async () => undefined;
    const rng = () => 0.5;
    const seen: string[] = [];

    const iterator = runOtaSequence('9.9.9', { sleep, rng });
    let step = await iterator.next();
    while (!step.done) {
      seen.push(step.value.phase);
      if (step.value.phase === 'rebooting') {
        // Simulate the device runtime's real disconnect/reconnect happening here.
        seen.push('runtime:disconnected');
        seen.push('runtime:reconnected');
      }
      step = await iterator.next();
    }

    const rebootIdx = seen.indexOf('rebooting');
    expect(seen[rebootIdx + 1]).toBe('runtime:disconnected');
    expect(seen[rebootIdx + 2]).toBe('runtime:reconnected');
    expect(seen[rebootIdx + 3]).toBe('complete');
  });
});
