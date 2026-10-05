/**
 * Structured logger — replaces `pino` + `pino-pretty` with Node core modules only.
 *
 * Two output modes:
 *   - production: one JSON object per line (machine readable, same shape pino emits)
 *   - development: human readable coloured lines
 *
 * Deliberately synchronous writes to stdout/stderr: pino's async worker transport would need a
 * thread, and for a cPanel-hosted monolith the ordering guarantee is worth more than the
 * marginal throughput.
 */
'use strict';

const LEVELS = { fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10, silent: 100 };
const LEVEL_NAMES = Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [v, k]));

const COLORS = {
  fatal: '\x1b[41;97m',
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  trace: '\x1b[90m',
};
const RESET = '\x1b[0m';

function formatValue(value) {
  if (value instanceof Error) {
    return { type: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function createLogger(options = {}) {
  const level = LEVELS[options.level] ?? LEVELS.info;
  const base = options.base ?? {};
  const pretty = options.pretty ?? false;

  const write = (levelValue, args) => {
    if (levelValue < level) return;

    const fields = { ...base };
    let message;

    for (const arg of args) {
      if (arg === undefined || arg === null) continue;
      if (typeof arg === 'string') {
        if (message === undefined) message = arg;
        else message += ` ${arg}`;
      } else if (arg instanceof Error) {
        fields.err = formatValue(arg);
      } else if (typeof arg === 'object') {
        Object.assign(fields, arg);
      } else {
        if (message === undefined) message = String(arg);
        else message += ` ${String(arg)}`;
      }
    }

    const levelName = LEVEL_NAMES[levelValue] ?? 'info';
    const stream = levelValue >= LEVELS.error ? process.stderr : process.stdout;

    if (pretty) {
      const time = new Date().toISOString().slice(11, 23);
      const extras = Object.entries(fields)
        .filter(([k]) => !['time', 'level'].includes(k))
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
      const color = process.stdout.isTTY ? (COLORS[levelName] ?? '') : '';
      const end = process.stdout.isTTY ? RESET : '';
      stream.write(`${color}${time} ${levelName.toUpperCase().padEnd(5)}${end} ${message ?? ''} ${extras}\n`);
      return;
    }

    const record = {
      level: levelValue,
      time: Date.now(),
      ...fields,
      msg: message ?? '',
    };
    stream.write(`${JSON.stringify(record)}\n`);
  };

  const logger = {
    level: options.level ?? 'info',
    fatal: (...args) => write(LEVELS.fatal, args),
    error: (...args) => write(LEVELS.error, args),
    warn: (...args) => write(LEVELS.warn, args),
    info: (...args) => write(LEVELS.info, args),
    debug: (...args) => write(LEVELS.debug, args),
    trace: (...args) => write(LEVELS.trace, args),
    /** Returns a child logger with additional bound fields (pino's child() semantics). */
    child(bindings) {
      return createLogger({ level: options.level, pretty, base: { ...base, ...bindings } });
    },
  };
  return logger;
}

module.exports = { createLogger, LEVELS };
