/**
 * Transactional email for recipients who are not platform users.
 *
 * Notifications (`user_notifications` + `notification_outbox`) only ever address a registered
 * account. Some mail has to reach someone who has no account here — a store shopper who bought a
 * digital product, a website visitor who wrote in through the inbox. This helper posts to the
 * platform's *existing* email transport (`NOTIFICATION_EMAIL_WEBHOOK_URL`/`_TOKEN`, the same
 * endpoint and payload contract the notification outbox uses), so CloudHost247 still has exactly one
 * mailer and one place where an operator configures sending.
 *
 * It never claims success it did not observe: the caller gets `sent`, `manual` (no transport
 * configured — the content is preserved and surfaced elsewhere) or `failed`, each with a note.
 */
export interface TransactionalEmail {
  to: string;
  name?: string | null;
  subject: string;
  text: string;
  template: string;
}

export interface TransactionalEmailDelivery {
  status: 'sent' | 'manual' | 'failed';
  /** Always populated: a short, customer-safe explanation of what happened. */
  note: string;
  delivered: boolean;
}

export interface TransactionalEmailOptions {
  source?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export async function sendTransactionalEmail(
  email: TransactionalEmail,
  options: TransactionalEmailOptions = {}
): Promise<TransactionalEmailDelivery> {
  const source = options.source ?? process.env;
  const url = source.NOTIFICATION_EMAIL_WEBHOOK_URL;
  const token = source.NOTIFICATION_EMAIL_WEBHOOK_TOKEN;

  if (!url || !token) {
    return {
      status: 'manual',
      delivered: false,
      note:
        'Outbound email is not configured on this platform yet, so this message was not sent. ' +
        'An administrator can enable sending by setting NOTIFICATION_EMAIL_WEBHOOK_URL and NOTIFICATION_EMAIL_WEBHOOK_TOKEN.',
    };
  }

  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        to: email.to,
        name: email.name ?? null,
        template: email.template,
        subject: email.subject,
        text: email.text,
      }),
    });
    if (response.ok) {
      return { status: 'sent', delivered: true, note: 'Sent by email.' };
    }
    return {
      status: 'failed',
      delivered: false,
      note:
        response.status === 401 || response.status === 403
          ? `The email transport rejected our credentials (HTTP ${response.status}). The message is saved here; ask an administrator to re-connect email sending.`
          : `The email transport returned HTTP ${response.status}, so the message was not delivered.`,
    };
  } catch (error) {
    return {
      status: 'failed',
      delivered: false,
      note: `The email transport could not be reached (${(error as Error).message}), so the message was not delivered.`,
    };
  }
}

/**
 * Shareable link for a public download token. Uses the deployment's own `APP_URL`; with no base
 * configured it degrades to a root-relative path rather than guessing a hostname.
 */
export function downloadLink(source: NodeJS.ProcessEnv, token: string): string {
  const path = `/api/v1/public/downloads/${token}`;
  const base = (source.APP_URL ?? '').replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}
