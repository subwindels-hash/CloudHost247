/**
 * Standalone environment-validation CLI: `npm run env:check`.
 *
 * Intended to be run from a cPanel terminal (or "Run NPM/Node command" in Application Manager)
 * right after configuring environment variables, and before starting/restarting the app, so
 * misconfiguration is caught with a clear message instead of a crash-looping Passenger process.
 */
import 'dotenv/config';
import { loadEnv, EnvValidationError } from './env';
import { trustedProxyAllowlistIsValid } from '../routes/visitor-ip';

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

  /**
   * The header's IP detector and the "What Is My IP" tool fail closed, so a bad
   * VISITOR_IP_TRUSTED_PROXIES never crashes the app — it silently reports no address forever.
   * That is invisible in production, which is exactly what this pre-flight exists to catch.
   */
  const mode = env.VISITOR_IP_MODE;
  if (mode === 'off') {
    // eslint-disable-next-line no-console
    console.log('  VISITOR_IP_MODE=off — the menu-bar IP detector reports no address, by design.');
    // eslint-disable-next-line no-console
    console.log('    Set "direct" (no reverse proxy in front) or "trusted-proxy" to enable it. See docs/visitor-ip-privacy.md.');
  } else if (mode === 'direct') {
    // eslint-disable-next-line no-console
    console.log('  VISITOR_IP_MODE=direct — using the socket peer; forwarding headers are ignored.');
    // eslint-disable-next-line no-console
    console.log('    Only correct when visitors connect to this process with no proxy, CDN or NAT in front.');
  } else {
    const list = env.VISITOR_IP_TRUSTED_PROXIES;
    if (!trustedProxyAllowlistIsValid(list)) {
      throw new EnvValidationError([
        `VISITOR_IP_MODE=trusted-proxy but VISITOR_IP_TRUSTED_PROXIES is ${list ? 'not parseable' : 'not set'}. ` +
        'It must be a comma-separated list of specific peer IPs and/or CIDR ranges covering every proxy hop ' +
        '(for example 203.0.113.7,198.51.100.0/24). A /0 is rejected.',
        'The IP detector fails closed until this is fixed, so it would silently report no address rather than fail visibly. See docs/visitor-ip-privacy.md.',
      ]);
    }
    // eslint-disable-next-line no-console
    console.log(`  VISITOR_IP_MODE=trusted-proxy — trusting ${String(list).split(',').length} entry/entries; X-Forwarded-For is walked right to left.`);
    // eslint-disable-next-line no-console
    console.log('    Those proxies must overwrite or correctly append X-Forwarded-For, or a visitor can state their own IP.');
  }
} catch (err) {
  if (err instanceof EnvValidationError) {
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
