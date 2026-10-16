/**
 * CloudHost247 mobile shell — public surface.
 *
 * The native projects (`android/`, `ios/`) are generated locally with `npx cap add android|ios`
 * and are gitignored by design (see `platform/.gitignore`); everything the app itself does lives
 * here and is shared with the web bundle, where it is a strict no-op.
 */
export { runMobileBoot, createMobileBoot, isNativePlatform } from './mobile-boot.js';
