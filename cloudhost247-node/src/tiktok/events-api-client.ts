import type { TikTokEvent } from './types';

export interface TikTokEventsApiCredentials { pixelId: string; token: string; testEventCode?: string | null }
export interface TikTokEventsApiEvent {
  eventName: TikTokEvent; eventId: string; occurredAt: string; sourceUrl: string;
  customData: Record<string, unknown>;
  user: { ttp?: string | null; ttclid?: string | null; externalIdHash?: string | null };
}
export interface TikTokEventsApiResult { accepted: boolean; httpStatus: number | null; eventsReceived: number | null; retryable: boolean; error: string | null }

export const TIKTOK_EVENTS_API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

/**
 * Official TikTok Events API v1.3 web-event endpoint. The access token travels
 * only in the `Access-Token` header, never in a URL/query value or the body.
 * HTTP acceptance (code 0) is TikTok's API acknowledgement, not proof of
 * Events Manager attribution; callers keep that distinction.
 * The same `event_id` the browser pixel fired is sent unchanged so TikTok can
 * deduplicate browser + server copies of one conversion.
 */
export async function sendTikTokEvent(credentials: TikTokEventsApiCredentials, event: TikTokEventsApiEvent, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<TikTokEventsApiResult> {
  if (!/^[A-Za-z0-9]{16,32}$/.test(credentials.pixelId) || !credentials.token || credentials.token.length > 4096 || /[\r\n]/.test(credentials.token)) {
    throw new Error('Invalid TikTok Events API credential configuration');
  }
  const eventTime = Math.floor(new Date(event.occurredAt).getTime() / 1000);
  if (!Number.isFinite(eventTime)) throw new Error('Invalid conversion event time');
  const user = Object.fromEntries(Object.entries({
    ttp: event.user.ttp ?? undefined,
    ttclid: event.user.ttclid ?? undefined,
    external_id: event.user.externalIdHash ?? undefined,
  }).filter(([, value]) => typeof value === 'string' && value.length > 0));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(30_000, Math.max(1000, timeoutMs)));
  const body = {
    event_source: 'web',
    event_source_id: credentials.pixelId,
    ...(credentials.testEventCode ? { test_event_code: credentials.testEventCode } : {}),
    data: [{
      event: event.eventName, event_time: eventTime, event_id: event.eventId,
      user, page: { url: event.sourceUrl }, properties: event.customData,
    }],
  };
  try {
    const response = await fetchImpl(TIKTOK_EVENTS_API_URL, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Access-Token': credentials.token }, body: JSON.stringify(body),
    });
    // TikTok returns {code, message, data}. code 0 = accepted. Only the code is
    // retained; provider messages/request ids are never stored or logged.
    let code: number | null = null;
    try {
      const result = await response.json() as { code?: unknown };
      if (Number.isInteger(result.code)) code = result.code as number;
    } catch { /* malformed body is not success */ }
    const accepted = response.ok && code === 0;
    // 429/5xx and transport failures are safe to retry with the SAME event_id
    // (TikTok deduplicates on event+event_id). Deterministic 4xx rejections are not.
    const retryable = !accepted && (response.status === 429 || response.status >= 500 || (response.ok && code === null));
    return { accepted, httpStatus: response.status, eventsReceived: accepted ? 1 : 0, retryable,
      error: accepted ? null : !response.ok ? `TikTok HTTP ${response.status}` : 'TikTok response did not confirm an accepted event' };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return { accepted: false, httpStatus: null, eventsReceived: null, retryable: true, error: timedOut ? 'TikTok request timed out' : 'TikTok network request failed' };
  } finally { clearTimeout(timer); }
}
