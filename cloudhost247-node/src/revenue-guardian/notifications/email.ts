/**
 * Revenue Guardian customer/staff email notifications (spec §22, §40, §75).
 *
 * Delivery rides the EXISTING notification pipeline (user_notifications + notification_outbox →
 * the platform's configured email webhook/SMTP bridge) — no second SMTP engine (spec §78).
 * Guarantees:
 *  - a payment-type email is refused when the invoice is no longer unpaid (spec §75);
 *  - deterministic dedupe keys make queueing idempotent (spec §50);
 *  - status stays 'queued' until the outbox honestly reports delivery — we never claim 'sent'
 *    because a row was inserted (spec §40, §63);
 *  - templates are code defaults overridable via platform settings, with {{variable}}
 *    substitution; a disabled template is 'suppressed', never silently dropped.
 */
import type { Queryable } from '../../db/types';
import { createNotification } from '../../services/notification-service';
import { recordCommunication } from '../repositories/automation-repo';
import { getRgSetting } from '../utils/settings';

export interface RgEmailTemplate {
  subject: string;
  text: string;
  enabled: boolean;
}

export const RG_DEFAULT_TEMPLATES: Record<string, RgEmailTemplate> = {
  invoice_due: {
    subject: 'Invoice {{invoiceNumber}} is due soon',
    text: 'Hello {{customerName}},\n\nYour invoice {{invoiceNumber}} for {{amount}} {{currency}} is due on {{dueDate}}. Please log in to your CloudHost247 account to complete payment and avoid any service interruption.\n\nThank you,\nCloudHost247 Billing',
    enabled: true,
  },
  invoice_overdue: {
    subject: 'Invoice {{invoiceNumber}} is overdue',
    text: 'Hello {{customerName}},\n\nOur records show invoice {{invoiceNumber}} for {{amount}} {{currency}} became due on {{dueDate}} and remains unpaid. Please settle it as soon as possible to keep your services active.\n\nIf you have already paid, please disregard this notice.\n\nThank you,\nCloudHost247 Billing',
    enabled: true,
  },
  payment_reminder: {
    subject: 'Payment reminder for invoice {{invoiceNumber}}',
    text: 'Hello {{customerName}},\n\nThis is a friendly reminder that invoice {{invoiceNumber}} for {{amount}} {{currency}} is awaiting payment.\n\nThank you,\nCloudHost247 Billing',
    enabled: true,
  },
  promise_reminder: {
    subject: 'Your payment arrangement is due',
    text: 'Hello {{customerName}},\n\nA payment of {{amount}} {{currency}} for invoice {{invoiceNumber}} was arranged for {{promisedDate}}. Please complete the payment to keep the arrangement on track.\n\nThank you,\nCloudHost247 Billing',
    enabled: true,
  },
  renewal_reminder: {
    subject: 'Your CloudHost247 service renews soon',
    text: 'Hello {{customerName}},\n\nYour service "{{serviceLabel}}" is due for renewal on {{expiryDate}} ({{daysRemaining}} day(s) from now). Renew on time to avoid interruption.\n\nThank you,\nCloudHost247',
    enabled: true,
  },
  pre_suspension: {
    subject: 'Action required: service at risk of suspension',
    text: 'Hello {{customerName}},\n\nYour service "{{serviceLabel}}" is at risk of suspension due to an unpaid balance. Please settle your outstanding invoices to keep the service running.\n\nThank you,\nCloudHost247 Billing',
    enabled: true,
  },
  pre_termination: {
    subject: 'Final notice: service scheduled for termination',
    text: 'Hello {{customerName}},\n\nYour suspended service "{{serviceLabel}}" will be terminated soon unless the outstanding balance is settled. After termination data may be unrecoverable.\n\nThank you,\nCloudHost247 Billing',
    enabled: true,
  },
  recovery_assignment: {
    subject: 'Revenue Guardian: case assigned to you',
    text: 'Hello {{staffName}},\n\nRecovery case {{caseNumber}} ({{customerEmail}}, {{amount}} {{currency}} outstanding) has been assigned to you.\n\nCloudHost247 Revenue Guardian',
    enabled: true,
  },
  recovery_escalation: {
    subject: 'Revenue Guardian: case escalated',
    text: 'Hello {{staffName}},\n\nRecovery case {{caseNumber}} has been escalated to level {{level}}. Outstanding: {{amount}} {{currency}}.\n\nCloudHost247 Revenue Guardian',
    enabled: true,
  },
};

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => variables[key] ?? '');
}

export async function resolveTemplate(db: Queryable, key: string): Promise<RgEmailTemplate | null> {
  const overrides = await getRgSetting(db, 'emailTemplates');
  const base = RG_DEFAULT_TEMPLATES[key];
  if (!base) return null;
  const override = overrides[key] ?? {};
  return {
    subject: override.subject ?? base.subject,
    text: override.text ?? base.text,
    enabled: override.enabled ?? base.enabled,
  };
}

export interface SendRgEmailInput {
  userId: string;
  recipient: string;
  templateKey: string;
  variables: Record<string, string>;
  customerId?: string | null;
  caseId?: string | null;
  invoiceId?: string | null;
  dedupeKey?: string | null;
  createdBy?: string | null;
  /**
   * Distinguishes repeat sends for the same resource (e.g. 7-day vs 3-day due reminders) in the
   * notification pipeline's (user_id, type, resource) idempotency index.
   */
  notificationTypeSuffix?: string;
}

export type SendRgEmailOutcome = 'queued' | 'duplicate' | 'suppressed' | 'invoice_not_unpaid' | 'unknown_template';

/**
 * Queues one templated email through the platform notification pipeline and records it in the
 * Revenue Guardian communication log. Returns the honest outcome — callers count only 'queued'
 * as a notification sent.
 */
export async function sendRgEmail(db: Queryable, input: SendRgEmailInput): Promise<SendRgEmailOutcome> {
  const template = await resolveTemplate(db, input.templateKey);
  if (!template) return 'unknown_template';

  // Safety gate (spec §75): never send payment communications for an invoice that is no longer
  // unpaid.
  const PAYMENT_TEMPLATES = ['invoice_due', 'invoice_overdue', 'payment_reminder', 'promise_reminder'];
  if (input.invoiceId && PAYMENT_TEMPLATES.includes(input.templateKey)) {
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [input.invoiceId]);
    if (rows[0]?.status !== 'unpaid') return 'invoice_not_unpaid';
  }

  const subject = renderTemplate(template.subject, input.variables);
  const body = renderTemplate(template.text, input.variables);

  if (!template.enabled) {
    await recordCommunication(db, {
      customerId: input.customerId ?? input.userId,
      caseId: input.caseId ?? null,
      invoiceId: input.invoiceId ?? null,
      channel: 'email',
      recipient: input.recipient,
      templateKey: input.templateKey,
      subject,
      body,
      status: 'suppressed',
      failureReason: 'Template disabled by administrator',
      dedupeKey: input.dedupeKey ?? null,
      createdBy: input.createdBy ?? null,
    });
    return 'suppressed';
  }

  // Dedupe check happens on the communication-log insert (unique dedupe_key): reserve the log
  // row FIRST, and only queue the notification when the reservation succeeded.
  const logRow = await recordCommunication(db, {
    customerId: input.customerId ?? input.userId,
    caseId: input.caseId ?? null,
    invoiceId: input.invoiceId ?? null,
    channel: 'email',
    recipient: input.recipient,
    templateKey: input.templateKey,
    subject,
    body,
    status: 'queued',
    dedupeKey: input.dedupeKey ?? null,
    createdBy: input.createdBy ?? null,
  });
  if (!logRow) return 'duplicate';

  const notificationId = await createNotification(db, {
    userId: input.userId,
    type: `RG_${input.templateKey.toUpperCase()}${input.notificationTypeSuffix ? `_${input.notificationTypeSuffix.toUpperCase()}` : ''}`,
    title: subject,
    message: body,
    resourceType: input.invoiceId ? 'invoice' : input.caseId ? 'rg_case' : null,
    resourceId: input.invoiceId ?? input.caseId ?? null,
  });
  if (notificationId) {
    await db.query(`UPDATE revenue_guardian_communication_log SET notification_id = $2 WHERE id = $1`, [
      logRow.id,
      notificationId,
    ]);
  } else {
    // The idempotent notification insert found an existing notification for this resource; the
    // communication remains logged as queued against the earlier pipeline entry.
    await db.query(
      `UPDATE revenue_guardian_communication_log SET status = 'suppressed', failure_reason = $2 WHERE id = $1`,
      [logRow.id, 'Duplicate notification suppressed by pipeline idempotency']
    );
    return 'duplicate';
  }
  return 'queued';
}
