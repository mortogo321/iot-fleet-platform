const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Tiny leveled logger respecting LOG_LEVEL; avoids leaving bare console.log calls behind. */
export function createLogger(minLevel: string): Logger {
  const min = (LEVELS as readonly string[]).includes(minLevel) ? (minLevel as Level) : 'info';
  const write = (level: Level, msg: string, meta?: Record<string, unknown>) => {
    if (LEVELS.indexOf(level) < LEVELS.indexOf(min)) return;
    const line = meta ? `[${level}] ${msg} ${JSON.stringify(meta)}` : `[${level}] ${msg}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (msg, meta) => write('debug', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
  };
}
