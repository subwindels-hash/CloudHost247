import type { StandardEvent } from './types';

export interface CapiCredentials { pixelId: string; apiVersion: string; token: string; testEventCode?: string | null }
export interface CapiEvent {
  eventName: StandardEvent; eventId: string; occurredAt: string; sourceUrl: string;
  customData: Record<string, unknown>; userData: { external_id?: string; fbp?: string | null; fbc?: string | null };
}
export interface CapiResult { accepted: boolean; httpStatus: number | null; eventsReceived: number | null; retryable: boolean; error: string | null }

/** Official Meta Graph endpoint. The access token is a bearer header, never a URL/query value.
 * HTTP acceptance is not proof of Events Manager processing; callers must keep that distinction. */
export async function sendCapiEvent(credentials: CapiCredentials, event: CapiEvent, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<CapiResult> {
  if (!/^[1-9][0-9]{4,31}$/.test(credentials.pixelId) || !/^v(?:2[3-9]|[3-9][0-9])\.0$/.test(credentials.apiVersion) || !credentials.token || credentials.token.length > 4096 || /[\r\n]/.test(credentials.token)) {
    throw new Error('Invalid Meta CAPI credential configuration');
  }
  const eventTime = Math.floor(new Date(event.occurredAt).getTime() / 1000);
  if (!Number.isFinite(eventTime)) throw new Error('Invalid conversion event time');
  const userData = Object.fromEntries(Object.entries(event.userData).filter(([, value]) => typeof value === 'string' && value.length > 0));
  if (!Object.keys(userData).length) throw new Error('CAPI event has no permitted matching data');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(30_000, Math.max(1000, timeoutMs)));
  const body = { data: [{ event_name: event.eventName, event_time: eventTime, event_id: event.eventId,
    event_source_url: event.sourceUrl, action_source: 'website', user_data: userData, custom_data: event.customData }],
    ...(credentials.testEventCode ? { test_event_code: credentials.testEventCode } : {}) };
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${credentials.apiVersion}/${credentials.pixelId}/events`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.token}` }, body: JSON.stringify(body),
    });
    // Read only the documented count and transient flag; never retain provider trace IDs or echoed input.
    let count: number | null = null;
    let transient = false;
    try {
      const result = await response.json() as { events_received?: unknown; error?: { is_transient?: unknown } };
      if (Number.isInteger(result.events_received) && (result.events_received as number) >= 0) count = result.events_received as number;
      transient = result.error?.is_transient === true;
    } catch { /* malformed body is not success */ }
    const accepted = response.ok && count !== null && count > 0;
    // Meta explicitly marks some 4xx failures transient. Trust that structured field rather
    // than retrying every 400 or parsing human-readable messages. A malformed 200 is ambiguous
    // and retries the same event ID; a malformed non-2xx is not automatically transient.
    const retryable = !accepted && (response.status === 429 || response.status >= 500 || transient || (response.ok && count === null));
    return { accepted, httpStatus: response.status, eventsReceived: count, retryable,
      error: accepted ? null : !response.ok ? `Meta HTTP ${response.status}` : 'Meta response did not confirm an accepted event' };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return { accepted: false, httpStatus: null, eventsReceived: null, retryable: true, error: timedOut ? 'Meta request timed out' : 'Meta network request failed' };
  } finally { clearTimeout(timer); }
}
