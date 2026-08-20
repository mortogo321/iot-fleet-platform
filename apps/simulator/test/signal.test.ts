import { describe, expect, it } from 'bun:test';
import { METRIC_BOUNDS, TelemetrySchema } from '@iot/shared';
import { mulberry32 } from '../src/random';
import {
  createSignalState,
  forceAnomaly,
  type SignalState,
  sampleTelemetry,
  stepSignal,
} from '../src/signal';

const SAMPLE_COUNT = 5000;
const ANOMALY_CHANCE = 0.02;

describe('signal generator', () => {
  it('produces TelemetrySchema-valid values across 5000 samples, including anomaly episodes', () => {
    const rng = mulberry32(1234);
    let state: SignalState = createSignalState(rng);
    // Force an early anomaly episode so the run definitely exercises the hot-spike path.
    state = forceAnomaly(state, rng);

    let sawAnomalySample = false;
    let maxTemperature = -Infinity;
    let minTemperature = Infinity;

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      state = stepSignal(state, 3, rng, ANOMALY_CHANCE);
      const telemetry = sampleTelemetry(state, rng);

      const result = TelemetrySchema.safeParse(telemetry);
      expect(result.success).toBe(true);

      expect(telemetry.temperature).toBeGreaterThanOrEqual(METRIC_BOUNDS.temperature.min);
      expect(telemetry.temperature).toBeLessThanOrEqual(METRIC_BOUNDS.temperature.max);
      expect(telemetry.humidity).toBeGreaterThanOrEqual(METRIC_BOUNDS.humidity.min);
      expect(telemetry.humidity).toBeLessThanOrEqual(METRIC_BOUNDS.humidity.max);
      expect(telemetry.battery).toBeGreaterThanOrEqual(METRIC_BOUNDS.battery.min);
      expect(telemetry.battery).toBeLessThanOrEqual(METRIC_BOUNDS.battery.max);

      if (state.anomaly) sawAnomalySample = true;
      maxTemperature = Math.max(maxTemperature, telemetry.temperature);
      minTemperature = Math.min(minTemperature, telemetry.temperature);
    }

    expect(sawAnomalySample).toBe(true);
    // Anomaly episodes should demonstrably push temperature into hot-spike territory (~50-55C).
    expect(maxTemperature).toBeGreaterThan(45);
    expect(minTemperature).toBeGreaterThanOrEqual(METRIC_BOUNDS.temperature.min);
  });

  it('drains and recharges battery within bounds over many ticks', () => {
    const rng = mulberry32(42);
    let state = createSignalState(rng);
    let sawLowBattery = false;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      state = stepSignal(state, 5, rng, 0); // anomalyChance 0 keeps this test focused on battery
      expect(state.battery).toBeGreaterThanOrEqual(0);
      expect(state.battery).toBeLessThanOrEqual(100);
      if (state.battery <= 5) sawLowBattery = true;
    }
    expect(sawLowBattery).toBe(true);
  });
});
