import geoip from 'geoip-lite';

export interface ApproximateGeo {
  countryName: string | null;
  countryCode: string | null;
  regionName: string | null;
  cityName: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

export interface ClientProfile {
  deviceCategory: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browserFamily: string;
  osFamily: string;
}

const EMPTY_GEO: ApproximateGeo = {
  countryName: null,
  countryCode: null,
  regionName: null,
  cityName: null,
  latitude: null,
  longitude: null,
  timezone: null,
};

function safeLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function countryLabel(code: string): string | null {
  try {
    const value = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    return value && value !== code ? value : null;
  } catch {
    return null;
  }
}

function coarseCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // GeoIP coordinates are city-centre estimates, not a visitor's position. Round further before
  // persistence/display to avoid suggesting street-level precision.
  return Math.round(value * 10) / 10;
}

/**
 * Local GeoIP lookup only. `ip` exists in the caller's stack briefly and is never returned,
 * logged, hashed or written to a visitor-intelligence table.
 */
export function resolveApproximateGeo(ip: string | null): ApproximateGeo {
  if (!ip) return { ...EMPTY_GEO };
  let result: ReturnType<typeof geoip.lookup>;
  try {
    result = geoip.lookup(ip);
  } catch {
    return { ...EMPTY_GEO };
  }
  if (!result || typeof result.country !== 'string' || !/^[A-Z]{2}$/.test(result.country)) {
    return { ...EMPTY_GEO };
  }
  const latitude = coarseCoordinate(result.ll?.[0]);
  const longitude = coarseCoordinate(result.ll?.[1]);
  const details = result as ReturnType<typeof geoip.lookup> & { timezone?: unknown };
  const timezone = typeof details.timezone === 'string' && details.timezone.length <= 64
    ? details.timezone
    : null;
  return {
    countryName: countryLabel(result.country),
    countryCode: result.country,
    regionName: safeLabel(result.region, 128),
    cityName: safeLabel(result.city, 128),
    latitude,
    longitude,
    timezone,
  };
}

/** Convert a request User-Agent into coarse family labels; never persist the raw header. */
export function classifyClient(userAgent: string | string[] | undefined): ClientProfile {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 2048) : '';
  if (!ua) return { deviceCategory: 'unknown', browserFamily: 'Other', osFamily: 'Other' };

  let browserFamily = 'Other';
  if (/edg\//i.test(ua)) browserFamily = 'Edge';
  else if (/opr\//i.test(ua)) browserFamily = 'Opera';
  else if (/firefox|fxios/i.test(ua)) browserFamily = 'Firefox';
  else if (/crios|chrome/i.test(ua)) browserFamily = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome|crios|chromium/i.test(ua)) browserFamily = 'Safari';
  else if (/msie|trident/i.test(ua)) browserFamily = 'Internet Explorer';

  let osFamily = 'Other';
  if (/windows nt/i.test(ua)) osFamily = 'Windows';
  else if (/android/i.test(ua)) osFamily = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) osFamily = /ipad/i.test(ua) ? 'iPadOS' : 'iOS';
  else if (/macintosh|mac os x/i.test(ua)) osFamily = 'macOS';
  else if (/cros/i.test(ua)) osFamily = 'Chrome OS';
  else if (/linux/i.test(ua)) osFamily = 'Linux';

  let deviceCategory: ClientProfile['deviceCategory'] = 'desktop';
  if (/ipad|tablet|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
    deviceCategory = 'tablet';
  } else if (/mobile|iphone|ipod|android/i.test(ua)) {
    deviceCategory = 'mobile';
  }

  return { deviceCategory, browserFamily, osFamily };
}

const AUTOMATION = /(?:bot|crawler|spider|slurp|headless|lighthouse|pagespeed|prerender|monitor|health.?check|healthcheck|kube.?probe|blackbox|pingdom|uptime|statuscake|datadog|newrelic|prometheus|curl\/|wget\/|facebookexternalhit|whatsapp)/i;

/** Verified crawlers and common uptime/health probes are not human visitor traffic. */
export function isAutomatedAgent(userAgent: string | string[] | undefined): boolean {
  return typeof userAgent === 'string' && AUTOMATION.test(userAgent.slice(0, 2048));
}
