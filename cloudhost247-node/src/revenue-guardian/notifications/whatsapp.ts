/**
 * Optional WhatsApp notification abstraction (spec §23, §63).
 *
 * Provider-agnostic interface with adapters selected by configuration. FAIL-CLOSED: when no
 * provider is configured (or credentials are incomplete) every send returns
 * WHATSAPP_CONFIGURATION_REQUIRED and the attempt is logged as configuration_required — the
 * module never pretends a message was sent.
 */
import type { Queryable } from '../../db/types';
import { recordCommunication } from '../repositories/automation-repo';
import { getRgSetting } from '../utils/settings';

export interface WhatsAppSendResult {
  status: 'sent' | 'failed' | 'configuration_required';
  providerMessageId?: string | null;
  error?: string | null;
}

export interface WhatsAppProvider {
  readonly name: string;
  send(to: string, message: string): Promise<WhatsAppSendResult>;
}

interface WhatsAppConfig {
  enabled: boolean;
  provider: string | null;
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  accessToken?: string;
  phoneNumberId?: string;
  [key: string]: unknown;
}

/** Twilio WhatsApp adapter. Uses the REST API directly; credentials come from settings. */
class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'twilio';
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(to: string, message: string): Promise<WhatsAppSendResult> {
    try {
      const body = new URLSearchParams({
        From: `whatsapp:${this.fromNumber}`,
        To: `whatsapp:${to}`,
        Body: message,
      });
      const res = await this.fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        }
      );
      const payload = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (res.status === 401 || res.status === 403) {
        return { status: 'configuration_required', error: 'Twilio rejected the configured credentials' };
      }
      if (!res.ok) {
        return { status: 'failed', error: payload.message ?? `Twilio error ${res.status}` };
      }
      return { status: 'sent', providerMessageId: payload.sid ?? null };
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : 'Network error' };
    }
  }
}

/** Meta WhatsApp Business Cloud API adapter. */
class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta';
  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(to: string, message: string): Promise<WhatsAppSendResult> {
    try {
      const res = await this.fetchImpl(`https://graph.facebook.com/v19.0/${encodeURIComponent(this.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id: string }>;
        error?: { message?: string; code?: number };
      };
      if (res.status === 401 || payload.error?.code === 190) {
        return { status: 'configuration_required', error: 'Meta rejected the configured access token' };
      }
      if (!res.ok) {
        return { status: 'failed', error: payload.error?.message ?? `Meta error ${res.status}` };
      }
      return { status: 'sent', providerMessageId: payload.messages?.[0]?.id ?? null };
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : 'Network error' };
    }
  }
}

/**
 * Builds the configured provider, or null when configuration is missing/incomplete —
 * the caller must then report CONFIGURATION_REQUIRED, never a fake success.
 */
export async function getWhatsAppProvider(db: Queryable, fetchImpl: typeof fetch = fetch): Promise<WhatsAppProvider | null> {
  const config = (await getRgSetting(db, 'whatsapp')) as WhatsAppConfig;
  if (!config.enabled) return null;
  if (config.provider === 'twilio' && config.accountSid && config.authToken && config.fromNumber) {
    return new TwilioWhatsAppProvider(config.accountSid, config.authToken, config.fromNumber, fetchImpl);
  }
  if (config.provider === 'meta' && config.accessToken && config.phoneNumberId) {
    return new MetaWhatsAppProvider(config.accessToken, config.phoneNumberId, fetchImpl);
  }
  return null;
}

export interface WhatsAppStatus {
  configured: boolean;
  enabled: boolean;
  provider: string | null;
  state: 'READY' | 'DISABLED' | 'CONFIGURATION_REQUIRED';
}

export async function getWhatsAppStatus(db: Queryable): Promise<WhatsAppStatus> {
  const config = (await getRgSetting(db, 'whatsapp')) as WhatsAppConfig;
  if (!config.enabled) {
    return { configured: false, enabled: false, provider: config.provider ?? null, state: 'DISABLED' };
  }
  const provider = await getWhatsAppProvider(db);
  return {
    configured: provider !== null,
    enabled: true,
    provider: config.provider ?? null,
    state: provider ? 'READY' : 'CONFIGURATION_REQUIRED',
  };
}

/**
 * Sends (or honestly refuses to send) a WhatsApp message, always logging the true outcome in
 * the communication log.
 */
export async function sendRgWhatsApp(
  db: Queryable,
  input: {
    customerId: string;
    recipient: string;
    templateKey: string;
    message: string;
    caseId?: string | null;
    invoiceId?: string | null;
    dedupeKey?: string | null;
    createdBy?: string | null;
  },
  fetchImpl: typeof fetch = fetch
): Promise<'sent' | 'failed' | 'duplicate' | 'WHATSAPP_CONFIGURATION_REQUIRED'> {
  const provider = await getWhatsAppProvider(db, fetchImpl);
  if (!provider) {
    await recordCommunication(db, {
      customerId: input.customerId,
      caseId: input.caseId ?? null,
      invoiceId: input.invoiceId ?? null,
      channel: 'whatsapp',
      recipient: input.recipient,
      templateKey: input.templateKey,
      subject: input.templateKey,
      body: input.message,
      status: 'configuration_required',
      failureReason: 'WhatsApp provider is not configured',
      dedupeKey: input.dedupeKey ?? null,
      createdBy: input.createdBy ?? null,
    });
    return 'WHATSAPP_CONFIGURATION_REQUIRED';
  }

  const logRow = await recordCommunication(db, {
    customerId: input.customerId,
    caseId: input.caseId ?? null,
    invoiceId: input.invoiceId ?? null,
    channel: 'whatsapp',
    recipient: input.recipient,
    templateKey: input.templateKey,
    subject: input.templateKey,
    body: input.message,
    provider: provider.name,
    status: 'queued',
    dedupeKey: input.dedupeKey ?? null,
    createdBy: input.createdBy ?? null,
  });
  if (!logRow) return 'duplicate';

  const result = await provider.send(input.recipient, input.message);
  await db.query(
    `UPDATE revenue_guardian_communication_log
        SET status = $2, provider_message_id = $3, failure_reason = $4,
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END
      WHERE id = $1`,
    [logRow.id, result.status === 'sent' ? 'sent' : result.status, result.providerMessageId ?? null, result.error ?? null]
  );
  return result.status === 'sent' ? 'sent' : result.status === 'configuration_required' ? 'WHATSAPP_CONFIGURATION_REQUIRED' : 'failed';
}
