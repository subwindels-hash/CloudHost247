/**
 * Design Studio — the forced-overwrite sunset.
 *
 * The sunset date was originally stated as 2026-05-09, which had already passed when the code was
 * written (the intent was six months from 2026-11-09 → 2027-05-09). The decision was to **honour** it
 * rather than extend it, so these tests pin two things: that the boundary is enforced at the exact
 * instant, and that the escape hatch is a deliberate, per-deployment act rather than a date that moves.
 *
 * Time is injected. A sunsets test that reads the wall clock would start failing on an arbitrary future
 * day for a reason nobody wrote down, which is how a regression gets "fixed" by deleting it.
 */
import { describe, expect, it } from 'vitest';
import {
  FORCED_OVERWRITE_ENV,
  FORCED_OVERWRITE_SUNSET,
  forcedOverwriteStatus,
  sunsetMessage,
} from '../../src/tools/design-studio/templates/sunset';

const at = (iso: string) => new Date(iso);
const noEnv: NodeJS.ProcessEnv = {};

describe('forced-overwrite sunset', () => {
  it('is the date that was published, not a moved one', () => {
    // If this ever changes, it must be a deliberate decision with a new date and new evidence — not an
    // edit that quietly resets the clock.
    expect(FORCED_OVERWRITE_SUNSET).toBe('2026-05-09');
  });

  it('refuses the path the moment the sunset arrives', () => {
    expect(forcedOverwriteStatus(at('2026-05-08T23:59:59Z'), noEnv)).toMatchObject({ allowed: true, reason: 'before sunset' });
    // Midnight UTC on the date itself: gone.
    expect(forcedOverwriteStatus(at('2026-05-09T00:00:00Z'), noEnv)).toMatchObject({ allowed: false, reason: 'sunset reached' });
    expect(forcedOverwriteStatus(at('2026-11-10T00:00:00Z'), noEnv)).toMatchObject({ allowed: false, reason: 'sunset reached' });
    expect(forcedOverwriteStatus(at('2030-01-01T00:00:00Z'), noEnv).allowed).toBe(false);
  });

  it('treats the re-open variable as an explicit act, and only for recognised values', () => {
    const afterSunset = at('2026-11-10T00:00:00Z');
    expect(forcedOverwriteStatus(afterSunset, { [FORCED_OVERWRITE_ENV]: 'true' })).toMatchObject({
      allowed: true,
      reason: 're-opened by environment',
    });
    expect(forcedOverwriteStatus(afterSunset, { [FORCED_OVERWRITE_ENV]: '1' }).allowed).toBe(true);
    // Anything else — including the empty string a misconfigured deployment leaves behind — keeps it
    // closed. A typo must fail closed, not open.
    for (const value of ['', 'false', 'yes', 'enabled', 'TRUE ']) {
      expect(forcedOverwriteStatus(afterSunset, { [FORCED_OVERWRITE_ENV]: value }).allowed, value).toBe(
        value.trim().toLowerCase() === 'true'
      );
    }
  });

  it('has a message that explains the removal and the one-line fix', () => {
    const message = sunsetMessage();
    expect(message).toContain('2026-05-09');
    expect(message).toContain('expectedRevision');
    // Nothing in it should read as "try again later" — the path is not coming back.
    expect(message).not.toMatch(/temporar|later|maintenance/i);
  });
});
