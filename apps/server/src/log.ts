/** Tiny leveled logger. No process.env access here — call setLogLevel(config.logLevel) at boot. */
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

let threshold: number = LEVELS.indexOf('info');

export function setLogLevel(level: string): void {
  const idx = LEVELS.indexOf(level as Level);
  threshold = idx === -1 ? LEVELS.indexOf('info') : idx;
}

function emit(level: Level, args: unknown[]): void {
  if (LEVELS.indexOf(level) < threshold) return;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(`[${level}]`, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => emit('debug', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
};
