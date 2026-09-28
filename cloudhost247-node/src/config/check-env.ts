/**
 * Standalone environment-validation CLI: `npm run env:check`.
 *
 * Intended to be run from a cPanel terminal (or "Run NPM/Node command" in Application Manager)
 * right after configuring environment variables, and before starting/restarting the app, so
 * misconfiguration is caught with a clear message instead of a crash-looping Passenger process.
 */
import { loadEnv, EnvValidationError } from './env';

try {
  const env = loadEnv();
  // eslint-disable-next-line no-console
  console.log('Environment OK.');
  // eslint-disable-next-line no-console
  console.log(`  NODE_ENV=${env.NODE_ENV}`);
  // eslint-disable-next-line no-console
  console.log(`  APP_URL=${env.APP_URL}`);
  // eslint-disable-next-line no-console
  console.log('  DATABASE_URL=<set, hidden>');
  // eslint-disable-next-line no-console
  console.log('  JWT_SECRET=<set, hidden>');
} catch (err) {
  if (err instanceof EnvValidationError) {
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
