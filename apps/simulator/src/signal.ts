import { METRIC_BOUNDS, type Telemetry, TelemetrySchema } from '@iot/shared';
import { gaussian } from './random';

const BASE_TEMPERATURE_C = 22;
const DIURNAL_TEMP_AMPLITUDE_C = 5;
const BASE_HUMIDITY_PCT = 50;
const DIURNAL_HUMIDITY_AMPLITUDE_PCT = 8;
/** Diurnal cycle length in simulated seconds — driven by elapsed sim time, not wall-clock hour. */
const DIURNAL_PERIOD_SEC = 86_400;

const DRIFT_DECAY = 0.98;
const TEMP_NOISE_STD = 0.3;
const HUMIDITY_NOISE_STD = 1.2;
const TEMP_DRIFT_STD = 0.05;
const HUMIDITY_DRIFT_STD = 0.3;
const TEMP_DRIFT_BOUND = 3;
const HUMIDITY_DRIFT_BOUND = 8;

/** Full drain/charge cycle rates — slow discharge, quicker recharge, like a real battery. */
const BATTERY_DRAIN_PCT_PER_HOUR = 100 / 3;
const BATTERY_CHARGE_PCT_PER_HOUR = 100 / 0.25;

const ANOMALY_MIN_SEC = 30;
const ANOMALY_MAX_SEC = 60;
const ANOMALY_PEAK_MIN_C = 50;
const ANOMALY_PEAK_MAX_C = 55;

export interface AnomalyEpisode {
  endSec: number;
  peakTemp: number;
}

export interface SignalState {
  tSec: number;
  driftTemp: number;
  driftHumidity: number;
  battery: number;
  batteryDirection: 1 | -1;
  anomaly: AnomalyEpisode | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createSignalState(rng: () => number = Math.random): SignalState {
  return {
    tSec: 0,
    driftTemp: 0,
    driftHumidity: 0,
    battery: 40 + rng() * 60,
    batteryDirection: -1,
    anomaly: null,
  };
}

function newAnomaly(tSec: number, rng: () => number): AnomalyEpisode {
  return {
    endSec: tSec + ANOMALY_MIN_SEC + rng() * (ANOMALY_MAX_SEC - ANOMALY_MIN_SEC),
    peakTemp: ANOMALY_PEAK_MIN_C + rng() * (ANOMALY_PEAK_MAX_C - ANOMALY_PEAK_MIN_C),
  };
}

/** Force-start a hot-spike episode right now (used by tests to exercise anomaly sampling). */
export function forceAnomaly(state: SignalState, rng: () => number = Math.random): SignalState {
  return { ...state, anomaly: newAnomaly(state.tSec, rng) };
}

/** Advance the signal by deltaSec of simulated time. Pure and deterministic given rng. */
export function stepSignal(
  state: SignalState,
  deltaSec: number,
  rng: () => number = Math.random,
  anomalyChance: number,
): SignalState {
  const tSec = state.tSec + deltaSec;

  const driftTemp = clamp(
    state.driftTemp * DRIFT_DECAY + gaussian(rng, TEMP_DRIFT_STD),
    -TEMP_DRIFT_BOUND,
    TEMP_DRIFT_BOUND,
  );
  const driftHumidity = clamp(
    state.driftHumidity * DRIFT_DECAY + gaussian(rng, HUMIDITY_DRIFT_STD),
    -HUMIDITY_DRIFT_BOUND,
    HUMIDITY_DRIFT_BOUND,
  );

  const rate =
    state.batteryDirection < 0 ? BATTERY_DRAIN_PCT_PER_HOUR : BATTERY_CHARGE_PCT_PER_HOUR;
  let battery = state.battery + state.batteryDirection * (deltaSec / 3600) * rate;
  let batteryDirection = state.batteryDirection;
  if (battery <= 0) {
    battery = 0;
    batteryDirection = 1;
  } else if (battery >= 100) {
    battery = 100;
    batteryDirection = -1;
  }

  let anomaly = state.anomaly;
  if (anomaly && tSec >= anomaly.endSec) anomaly = null;
  if (!anomaly && rng() < anomalyChance) anomaly = newAnomaly(tSec, rng);

  return { tSec, driftTemp, driftHumidity, battery, batteryDirection, anomaly };
}

/** Render current signal state into a schema-valid telemetry reading (no timestamp — pure). */
export function sampleTelemetry(state: SignalState, rng: () => number = Math.random): Telemetry {
  const phase = (state.tSec / DIURNAL_PERIOD_SEC) * 2 * Math.PI;
  let temperature =
    BASE_TEMPERATURE_C +
    DIURNAL_TEMP_AMPLITUDE_C * Math.sin(phase) +
    state.driftTemp +
    gaussian(rng, TEMP_NOISE_STD);
  let humidity =
    BASE_HUMIDITY_PCT -
    DIURNAL_HUMIDITY_AMPLITUDE_PCT * Math.sin(phase) +
    state.driftHumidity +
    gaussian(rng, HUMIDITY_NOISE_STD);

  if (state.anomaly) {
    temperature = state.anomaly.peakTemp + gaussian(rng, 0.5);
    humidity = humidity - 15; // a hot spike dries the air out a bit
  }

  return TelemetrySchema.parse({
    temperature: Number(
      clamp(temperature, METRIC_BOUNDS.temperature.min, METRIC_BOUNDS.temperature.max).toFixed(2),
    ),
    humidity: Number(
      clamp(humidity, METRIC_BOUNDS.humidity.min, METRIC_BOUNDS.humidity.max).toFixed(2),
    ),
    battery: Number(
      clamp(state.battery, METRIC_BOUNDS.battery.min, METRIC_BOUNDS.battery.max).toFixed(2),
    ),
  });
}
