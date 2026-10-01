/**
 * Server-side operational limits for Domain Services.
 *
 * These are the platform's defensive ceilings. They are intentionally stricter than what any
 * registrar API tolerates, so the platform can never fan out unbounded provider requests, and they
 * can be tightened further per provider through each provider's `configuration` JSON.
 */

/** Maximum candidate domains a single bulk search may accept (others are rejected and counted). */
export const BULK_SEARCH_MAX_DOMAINS = 200;

/** Maximum domains sent to the provider adapter per availability batch. */
export const BULK_SEARCH_BATCH_SIZE = 20;

/** Maximum single-search result rows (one row per enabled extension when searching a bare term). */
export const SINGLE_SEARCH_MAX_RESULTS = 30;

/** Minimum seconds between bulk searches per user. */
export const BULK_SEARCH_USER_COOLDOWN_SECONDS = 30;

/** Maximum bulk searches per user per rolling hour (DB-counted, not in-memory). */
export const BULK_SEARCH_MAX_PER_HOUR = 10;

/** Maximum single WHOIS/RDAP lookups per user per rolling hour. */
export const WHOIS_LOOKUP_MAX_PER_HOUR = 20;

/** WHOIS lookups are available to signed-in users only; anonymous calls are rejected. */

/** Maximum appraisal requests per user per rolling day (each one is provider-metered). */
export const APPRAISAL_MAX_PER_DAY = 10;

/** Maximum auctions listed per page (browse). */
export const AUCTIONS_PAGE_MAX_LIMIT = 50;

/** Server-side minimum auction duration and maximum listing window. */
export const AUCTION_MIN_DURATION_HOURS = 1;
export const AUCTION_MAX_DURATION_DAYS = 30;

/** Domain registration term limits (years) — mirrors the database CHECK constraint. */
export const REGISTRATION_MIN_YEARS = 1;
export const REGISTRATION_MAX_YEARS = 10;
