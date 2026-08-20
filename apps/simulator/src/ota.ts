import { type OtaProgress, OtaProgressSchema } from '@iot/shared';

export interface OtaRunnerOptions {
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
}

const DOWNLOAD_TOTAL_MS = 6000;
const PHASE_PAUSE_MS = 500;

/**
 * Pure phase-sequence generator: yields schema-valid OTA progress events in contract order.
 * Timing/randomness are injectable so the sequence is unit-testable without real timers.
 *
 * The 'rebooting' phase intentionally does NOT sleep internally — the caller (device runtime)
 * owns the real mqtt disconnect/reconnect dance around that event before requesting 'complete'.
 */
export async function* runOtaSequence(
  version: string,
  opts: OtaRunnerOptions = {},
): AsyncGenerator<OtaProgress> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const rng = opts.rng ?? Math.random;

  const steps = 4 + Math.floor(rng() * 3); // 4..6 progress events
  const perStepMs = DOWNLOAD_TOTAL_MS / steps;
  for (let i = 1; i <= steps; i++) {
    await sleep(perStepMs);
    yield OtaProgressSchema.parse({
      version,
      phase: 'downloading',
      progress: Math.round((i / steps) * 100),
      detail: `chunk ${i}/${steps}`,
    });
  }

  await sleep(PHASE_PAUSE_MS);
  yield OtaProgressSchema.parse({ version, phase: 'verifying', progress: 100 });

  await sleep(PHASE_PAUSE_MS);
  yield OtaProgressSchema.parse({ version, phase: 'applying', progress: 100 });

  yield OtaProgressSchema.parse({ version, phase: 'rebooting', progress: 100 });

  yield OtaProgressSchema.parse({ version, phase: 'complete', progress: 100 });
}
