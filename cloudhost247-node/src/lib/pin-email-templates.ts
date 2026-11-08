/**
 * Email copy for the Security PIN flows.
 *
 * Two hard rules, enforced by the shape of these functions rather than by reviewers remembering:
 *
 *   1. **The PIN never appears in a notification.** `securityPinRotatedEmail` takes no PIN
 *      argument at all — it cannot leak one, because there is nothing to pass. The only way to read
 *      a PIN is the verified in-app reveal, which never touches email or logs.
 *   2. **The verification code goes to exactly one place**: the address stored on the account, and
 *      only inside the mail body queued for that address. It is never returned by an API, never put
 *      in a URL, and never written to an audit row.
 *
 * Templates are plain text on purpose: they are delivered through the platform's single existing
 * mail transport (see src/services/auth-recovery-service.ts), which posts a subject/text pair.
 */

export interface EmailContent {
  subject: string;
  text: string;
}

function greeting(name: string | null | undefined): string {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return first ? `Hello ${first},` : 'Hello,';
}

function maskEmail(email: string): string {
  const [local, domain] = String(email ?? '').split('@');
  if (!local || !domain) return 'your registered email address';
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

/**
 * The six-digit code that unlocks *one* view of the Security PIN. Deliberately mentions the
 * expiry, the single-use rule and the "we never ask for this" warning — the three things that make
 * a phishing copy of this mail useless.
 */
export function securityPinVerificationCodeEmail(input: {
  name?: string | null;
  email: string;
  code: string;
  ttlMinutes: number;
  customerId?: string | null;
}): EmailContent {
  return {
    subject: 'Your CloudHost247 verification code',
    text: [
      greeting(input.name),
      '',
      'Someone (hopefully you) asked to view the Security PIN on your CloudHost247 account.',
      'Enter this code in the "Verify it\'s you" window to continue:',
      '',
      `    ${input.code}`,
      '',
      `The code expires in ${input.ttlMinutes} minutes and works once.`,
      `It was sent to ${maskEmail(input.email)}${input.customerId ? ` for Customer ID ${input.customerId}` : ''}.`,
      '',
      'If this was not you, do not share the code with anyone. Change your password and contact support:',
      'nobody at CloudHost247 will ever ask you for this code or for your Security PIN.',
      '',
      '— CloudHost247 Account Security',
    ].join('\n'),
  };
}

/**
 * Sent after the PIN rotates. Intentionally contains no PIN, no hint about its digits, and no link
 * that could be used to retrieve it — the notification exists so a customer notices unexpected
 * activity, not so the credential can travel through email.
 */
export function securityPinRotatedEmail(input: {
  name?: string | null;
  customerId?: string | null;
  rotatedAt: string;
  nextRotationAt: string;
}): EmailContent {
  return {
    subject: 'Your CloudHost247 Security PIN has changed',
    text: [
      greeting(input.name),
      '',
      'Your four-digit Security PIN has been rotated automatically, as it is every 24 hours.',
      '',
      `Rotated: ${input.rotatedAt}`,
      `Next rotation: ${input.nextRotationAt}`,
      ...(input.customerId ? [`Customer ID: ${input.customerId}`] : []),
      '',
      'For your safety the PIN itself is never included in email. To read it, sign in, open',
      'Account → Account Security and choose "View Security PIN"; we will email a fresh six-digit',
      'code to this address and show the PIN for 30 seconds after you enter it.',
      '',
      'If you did not expect this, change your password and contact support.',
      '',
      '— CloudHost247 Account Security',
    ].join('\n'),
  };
}

/**
 * Confirmation that a recovery request was opened. Sent to the address on the account (not to the
 * address typed into the form) so the real owner is told even when the requester is not the owner.
 */
export function accountRecoveryRequestedEmail(input: {
  name?: string | null;
  reference: string;
  reason: string;
}): EmailContent {
  return {
    subject: `CloudHost247 account recovery request ${input.reference}`,
    text: [
      greeting(input.name),
      '',
      'We received a request to recover access to your CloudHost247 account because the person',
      'could not complete email verification.',
      '',
      `Reference: ${input.reference}`,
      `Reason given: ${input.reason}`,
      '',
      'Nothing about your account has changed yet. Recovery never reveals or resets your Security',
      'PIN, and it cannot change your registered email address on its own: a specialist will',
      'verify identity first, and you will still have to verify this address again afterwards.',
      '',
      'If you made this request, quote the reference when support contacts you. If you did not,',
      'reply to this email immediately and change your password.',
      '',
      '— CloudHost247 Account Security',
    ].join('\n'),
  };
}

/** Tells the customer their recovery was approved and what that does (and does not) do. */
export function accountRecoveryApprovedEmail(input: { name?: string | null; reference: string }): EmailContent {
  return {
    subject: 'CloudHost247 account recovery approved',
    text: [
      greeting(input.name),
      '',
      `Your account recovery request (${input.reference}) has been approved after identity verification.`,
      '',
      'What changed:',
      '  - Your email address must be verified again before any Security PIN can be viewed.',
      '  - Any verification code that was outstanding has been cancelled.',
      '',
      'What did NOT change:',
      '  - Your Security PIN was not revealed, reset, or sent to anyone.',
      '  - Your registered email address was not changed automatically.',
      '',
      'Sign in and complete verification when you are ready. If you did not request this, contact',
      'support immediately.',
      '',
      '— CloudHost247 Account Security',
    ].join('\n'),
  };
}

/** Security-change notice for a username change (no secret material, just the fact and the handle). */
export function usernameChangedEmail(input: { name?: string | null; username: string; when: string }): EmailContent {
  return {
    subject: 'Your CloudHost247 username was changed',
    text: [
      greeting(input.name),
      '',
      `Your CloudHost247 username is now "${input.username}".`,
      `Changed: ${input.when}`,
      '',
      'Your Customer ID, Security PIN and password are unchanged. If you did not make this change,',
      'change your password and contact support immediately.',
      '',
      '— CloudHost247 Account Security',
    ].join('\n'),
  };
}
