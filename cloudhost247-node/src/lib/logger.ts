import pino from 'pino';
import type { Env } from '../config/env';

/**
 * Structured logger. In production we deliberately avoid pino-pretty (it exists only as a
 * devDependency) so log lines stay newline-delimited JSON, which is what cPanel's Application
 * Manager log viewer and `tail`/`grep` over the app's stderr/stdout log files handle best.
 *
 * Never log secrets: callers must not pass raw passwords, tokens, SMTP credentials, or full
 * connection strings into logger calls. Redaction paths below cover the most likely accidents.
 */
export function createLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.password_hash',
        '*.token',
        '*.secret',
        '*.DATABASE_URL',
        '*.smtpPassword',
      ],
      censor: '[redacted]',
    },
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  });
}
