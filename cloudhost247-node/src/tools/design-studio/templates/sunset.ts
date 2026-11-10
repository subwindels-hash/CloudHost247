/**
 * Design Studio — the forced-overwrite sunset.
 *
 * ## What went wrong, recorded rather than quietly fixed
 *
 * The compatibility path (`PUT /templates/:id` with `force: true`) was introduced with a stated sunset
 * of **2026-05-09**, derived from a wrong sum: the intent was "six months from today (2026-11-09)",
 * which is **2027-05-09**. The date was therefore already in the past on the day the code was written,
 * and the path shipped expired.
 *
 * The correction is *not* to extend it. A sunset that moves whenever it is inconvenient is decoration,
 * and the reason this path exists at all was to stop it becoming the quiet default. It is closed here,
 * at the date that was published, and the client-cost of that is a 410 with a precise remedy.
 *
 * ## Shape of the closure
 *
 *   • The route still recognises `force: true` and the header, so a legacy client gets a *diagnosis*
 *     rather than a validation error that reads like a typo.
 *   • It answers **410 Gone** — not 400 — because "this operation used to exist and no longer does"
 *     is a materially different message from "you sent something malformed".
 *   • The repository is one edit away from compiled out entirely: this module is the only gate.
 *
 * ## Re-opening it
 *
 * Setting `DESIGN_STUDIO_ALLOW_FORCED_OVERWRITE=true` restores the path **for one server**, with a
 * printed warning at boot, and every use is audited as `DESIGN_STUDIO_TEMPLATE_FORCED`. That is an
 * operator's emergency lever, not a recommendation: it is a per-deployment environment variable that
 * has to be set deliberately, and the docs say it must never be set in production.
 *
 * A second *date* extension is not offered by this module at all. If one is ever wanted, it must be a
 * new decision with a new date and the same evidence requirements, not a constant edited in place.
 */

/** The published sunset date. Past tense on purpose: this is a date that has passed. */
export const FORCED_OVERWRITE_SUNSET = '2026-05-09';

/** The environment variable that re-opens the path for one deployment, deliberately. */
export const FORCED_OVERWRITE_ENV = 'DESIGN_STUDIO_ALLOW_FORCED_OVERWRITE';

export interface ForcedOverwriteStatus {
  /** False once the sunset has passed, unless the operator re-opened it. */
  allowed: boolean;
  /** Why it is allowed or refused, for the log line and the 410 body. */
  reason: 're-opened by environment' | 'sunset reached' | 'before sunset';
  sunset: string;
}

/**
 * Decide whether the compatibility path may run, as of `now`.
 *
 * Pure and time-injected so the tests can assert the boundary without waiting until May 2027, and so
 * the deployed behaviour cannot differ from the tested behaviour through a cached `Date.now()`.
 */
export function forcedOverwriteStatus(
  now: Date,
  env: NodeJS.ProcessEnv = process.env
): ForcedOverwriteStatus {
  const sunset = new Date(`${FORCED_OVERWRITE_SUNSET}T00:00:00Z`);
  const afterSunset = now.getTime() >= sunset.getTime();
  if (!afterSunset) return { allowed: true, reason: 'before sunset', sunset: FORCED_OVERWRITE_SUNSET };

  const reOpened = (env[FORCED_OVERWRITE_ENV] ?? '').trim().toLowerCase();
  if (reOpened === 'true' || reOpened === '1') {
    return { allowed: true, reason: 're-opened by environment', sunset: FORCED_OVERWRITE_SUNSET };
  }
  return { allowed: false, reason: 'sunset reached', sunset: FORCED_OVERWRITE_SUNSET };
}

/** The 410 body's message: what happened, and the one-line fix for the caller. */
export function sunsetMessage(): string {
  return (
    `Unconditional overwrites were removed on ${FORCED_OVERWRITE_SUNSET}. ` +
    'Read the template (GET /api/tools/design-studio/templates/:id), take `revision` from the response, ' +
    'and send it as `expectedRevision` on the PUT. That single change makes the save version-checked, ' +
    'which is the behaviour this compatibility path was standing in for.'
  );
}
