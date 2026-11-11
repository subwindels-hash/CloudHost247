/**
 * Fraud Sentinel detection rule catalogue — the code-side source of truth for the reviewed default
 * rule set.
 *
 * Migration 0101 seeds these exact rows into `fraud_sentinel_rules`. The two are asserted to match
 * field-for-field (including description text) by
 * tests/integration/fraud-sentinel-migration.test.ts, so the documented catalogue can never drift
 * from what the database actually enforces.
 *
 * Every rule is:
 *   * DETERMINISTIC — a pure function of recorded rows; no randomness, no clock reads inside the
 *     rule (the evaluation instant is an argument), no external service call.
 *   * GROUNDED — `dataSources` lists the real tables it reads. A rule may not claim a source it does
 *     not use, and no rule reads a table that does not exist in the committed migration chain.
 *   * EXPLAINABLE — it emits a human-readable `reason`, a stable `reasonCode`, and `evidence`
 *     pointers at the real rows behind it.
 *   * ADVISORY — its `recommendation` tells a human what to look at. It never instructs the platform
 *     to block, refund, suspend or seize anything.
 *
 * Rule codes are the stable contract: they appear in assessments, alerts, evidence, the dashboard and
 * the rule-history audit trail. A code is never renamed; a behaviour change bumps `version`.
 */
import type { FraudCategory, RuleSeverity, SubjectType } from '../types';

/** Correlated-rule families. The family cap is the anti-double-counting mechanism: several rules
 * describing the SAME underlying incident cannot stack past the cap. */
export const RULE_FAMILIES = [
  'payment_failures',
  'payment_integrity',
  'payment_value',
  'account_auth',
  'account_recovery',
  'account_change',
  'account_cluster',
  'order_velocity',
  'order_value',
  'service_abuse',
  'admin_activity',
  'webhook_integrity',
] as const;
export type RuleFamily = (typeof RULE_FAMILIES)[number];

/** Default family caps, mirrored in the `fraud_sentinel.family_caps` setting seeded by migration
 * 0101 and documented in docs/FRAUD_SENTINEL.md §5. */
export const DEFAULT_FAMILY_CAPS: Readonly<Record<RuleFamily, number>> = {
  payment_failures: 30,
  payment_integrity: 28,
  payment_value: 20,
  account_auth: 30,
  account_recovery: 22,
  account_change: 24,
  account_cluster: 18,
  order_velocity: 22,
  order_value: 24,
  service_abuse: 22,
  admin_activity: 30,
  webhook_integrity: 22,
};

/** Default level thresholds — the same 25/50/75 scale Revenue Guardian uses. */
export const DEFAULT_RISK_THRESHOLDS = { medium: 25, high: 50, critical: 75 } as const;

export interface RuleDefinition {
  code: string;
  name: string;
  description: string;
  category: FraudCategory;
  family: RuleFamily;
  version: number;
  enabled: boolean;
  weight: number;
  severity: RuleSeverity;
  parameters: Record<string, unknown>;
  recommendation: string;
  dataSources: readonly string[];
  appliesTo: readonly SubjectType[];
}

/**
 * The 40 reviewed default rules.
 *
 * Ordering is the documented catalogue order: payment fraud (A), account security (B), order and
 * service abuse (C), administrative and API activity (D).
 */
export const RULE_CATALOGUE: readonly RuleDefinition[] = [
  /* =========================== A. Payment fraud indicators =========================== */
  {
    code: 'PAY_REPEATED_FAILURES',
    name: 'Repeated payment failures',
    description:
      "Counts payments.status = 'failed' rows for the customer inside the lookback window. A customer whose card is declined repeatedly is either in financial distress or trying stolen credentials; both need a human look. Evidence is the real payments rows.",
    category: 'payment',
    family: 'payment_failures',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: { windowDays: 30, threshold: 3 },
    recommendation:
      "Review the failed payments rows with the customer before any retry. Confirm the funding instrument is theirs and current. Do not change the payment method on the customer's behalf without a verified request.",
    dataSources: ['payments', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_FAILURE_BURST',
    name: 'Payment failure burst (card-testing pattern)',
    description:
      'Counts failed payment attempts inside a short window (default 60 minutes). Rapid successive declines against one or more invoices is the signature of automated card testing. Uses only recorded payments rows.',
    category: 'payment',
    family: 'payment_failures',
    version: 1,
    enabled: true,
    weight: 18,
    severity: 'high',
    parameters: { windowMinutes: 60, threshold: 3 },
    recommendation:
      'Treat as possible card testing. Check whether the same instrument or IP appears on other accounts (ACC_IP_FAILURE_SPRAY, ACC_SHARED_REGISTRATION_CLUSTER). Preserve the payments rows; do not retry the charge while under review.',
    dataSources: ['payments', 'fraud_sentinel_events'],
    // Customer subject only: `payments` records no IP address, so an IP subject can never carry
    // payment-failure evidence and claiming otherwise would be claiming telemetry that does not exist.
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_SUCCESS_AFTER_FAILURES',
    name: 'Successful payment immediately after repeated failures',
    description:
      'A successful payment preceded by several failures within the configured window. This is the strongest recorded card-testing indicator: many declines then one approval. Built from payments.status transitions only.',
    category: 'payment',
    family: 'payment_failures',
    version: 1,
    enabled: true,
    weight: 22,
    severity: 'critical',
    parameters: { windowHours: 24, minFailures: 3 },
    recommendation:
      'Verify with the cardholder through a known-good contact channel before provisioning or delivering service. Confirm the successful charge with the gateway. Any refund decision stays in the existing authorized billing workflow with human approval.',
    dataSources: ['payments', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_DUPLICATE_ATTEMPT',
    name: 'Duplicate payment attempt on the same invoice',
    description:
      "Two or more payment attempts against the same invoice with the same amount, currency and provider inside a short window. May be a double-click, a retry loop, or deliberate duplicate charging. Distinct from the webhook ledger's own idempotency, which prevents duplicate RECORDS, not duplicate ATTEMPTS.",
    category: 'payment',
    family: 'payment_integrity',
    version: 1,
    enabled: true,
    weight: 14,
    severity: 'medium',
    parameters: { windowMinutes: 15 },
    recommendation:
      'Compare the provider_reference values at the gateway before concluding a double charge happened. If money was taken twice, the refund goes through the existing authorized refund workflow with human approval — never from this module.',
    dataSources: ['payments', 'invoices', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_METHOD_CHURN',
    name: 'Suspicious churn of payment details',
    description:
      'Counts distinct (provider, method) pairs used by the customer inside the window. Repeatedly switching instruments across attempts is what an attacker does when each stolen card declines. Recorded fields only: payments.provider and payments.method.',
    category: 'payment',
    family: 'payment_integrity',
    version: 1,
    enabled: true,
    weight: 10,
    severity: 'medium',
    parameters: { windowDays: 7, threshold: 3 },
    recommendation:
      'Ask the customer to confirm which instrument is genuinely theirs. Check whether the other instruments appear on unrelated accounts. Never store or request full card details during the review.',
    dataSources: ['payments', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_UNUSUAL_FREQUENCY',
    name: 'Unusual payment frequency',
    description:
      'Total payment attempts (any status) in the window above the configured ceiling for one customer. Legitimate customers rarely attempt a dozen payments in a week.',
    category: 'payment',
    family: 'payment_value',
    version: 1,
    enabled: true,
    weight: 10,
    severity: 'medium',
    parameters: { windowDays: 7, threshold: 10 },
    recommendation:
      'Establish whether the attempts are customer-driven or a retry loop in a gateway/webhook path. If automated, the fix is in the payment workflow, not the customer record.',
    dataSources: ['payments', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_UNUSUAL_VALUE',
    name: 'Unusual payment value for this customer',
    description:
      "The largest payment amount in the window is at least `multiplier` times the customer's own median successful payment, or exceeds the absolute floor when there is not enough history. Comparison is per-customer, so a large enterprise order is not flagged for being large — only for being large FOR THEM.",
    category: 'payment',
    family: 'payment_value',
    version: 1,
    enabled: true,
    weight: 16,
    severity: 'high',
    parameters: { multiplier: 5, minHistory: 3, floorAmount: '1000.00' },
    recommendation:
      'Confirm the order behind the payment is genuine and authorized by the account holder. Where history is too thin the assessment carries a NO_PAYMENT_HISTORY data-quality flag — treat the score as indicative, not conclusive.',
    dataSources: ['payments', 'invoices', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_AMOUNT_MISMATCH',
    name: 'Payment amount does not match the invoice total',
    description:
      "A successful or partially-refunded payment whose amount differs from its invoice's total_amount by more than the tolerance. Overpayment and underpayment both indicate tampering, a manipulated client, or an inconsistent record.",
    category: 'payment',
    family: 'payment_integrity',
    version: 1,
    enabled: true,
    weight: 14,
    severity: 'high',
    parameters: { toleranceAmount: '0.01' },
    recommendation:
      'Reconcile payments.amount against invoices.total_amount and billing_ledger. The ledger is authoritative; do not "correct" it — a reversing entry is the only permitted fix, and it belongs to the existing billing workflow.',
    dataSources: ['payments', 'invoices', 'billing_ledger', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_CURRENCY_MISMATCH',
    name: 'Currency inconsistent across order, invoice and payment',
    description:
      "payments.currency differs from its invoice's currency, or invoices.currency differs from its order's currency. Inconsistent customer/transaction information of exactly the kind the authorization asks to detect.",
    category: 'payment',
    family: 'payment_integrity',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: {},
    recommendation:
      'Trace the currency from the cart through checkout to the gateway. A mismatch usually means a display-FX path wrote a converted amount somewhere it should not have; fix the workflow, not the historical rows.',
    dataSources: ['payments', 'invoices', 'orders', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_REFUND_REVERSAL',
    name: 'Refund / chargeback-proxy reversals',
    description:
      "Counts recorded money reversals in the window: billing_ledger entry_type = 'refund' or 'credit', payments.status refunded/partially_refunded, invoices.status refunded/partially_refunded/void. HONEST SCOPE: no gateway in src/payments records a chargeback event type, so this rule detects refunds and credits as chargeback PROXIES and never claims a confirmed chargeback.",
    category: 'payment',
    family: 'payment_integrity',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: { windowDays: 30, threshold: 1 },
    recommendation:
      'Confirm who authorized each reversal through audit_logs and the existing refund workflow. A pattern of pay-then-refund across orders is friendly fraud; a single authorized refund is normal business.',
    dataSources: ['billing_ledger', 'payments', 'invoices', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'PAY_REFUND_VELOCITY',
    name: 'Refund requested almost immediately after payment',
    description:
      'A refund recorded within `maxDaysBetweenPaymentAndRefund` days of the payment it reverses. Fast pay-then-refund cycles are used to launder a stolen card through a legitimate-looking order.',
    category: 'payment',
    family: 'payment_integrity',
    version: 1,
    enabled: true,
    weight: 16,
    severity: 'high',
    parameters: { maxDaysBetweenPaymentAndRefund: 7 },
    recommendation:
      'Check whether the service was used or delivered between payment and refund. Correlate with ACC_NEW_GEO_LOGIN and ORD_HIGH_VALUE_NEW_ACCOUNT before concluding anything.',
    dataSources: ['billing_ledger', 'payments', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },

  /* ========================= B. Account security indicators ========================== */
  {
    code: 'ACC_LOGIN_FAILURE_CLUSTER',
    name: 'Repeated authentication failures on one account',
    description:
      "Counts auth_audit_log event_type = 'login_failure' rows for the account in the window. Brute force or a forgotten password — the detector does not decide which, and never locks the account.",
    category: 'account_security',
    family: 'account_auth',
    version: 1,
    enabled: true,
    weight: 14,
    severity: 'medium',
    parameters: { windowHours: 24, threshold: 5 },
    recommendation:
      'Contact the customer through a verified channel. If it was not them, follow the existing account-recovery workflow (which has its own identity verification and human approval). This module performs no lockout.',
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_IP_FAILURE_SPRAY',
    name: 'One IP failing logins across many accounts (password spraying)',
    description:
      'For an IP subject: at least `minFailures` login_failure rows targeting at least `minAccounts` distinct accounts in the window. Cross-account fan-out from one source is the distinguishing feature versus a single customer mistyping a password.',
    category: 'account_security',
    family: 'account_auth',
    version: 1,
    enabled: true,
    weight: 20,
    severity: 'high',
    parameters: { windowHours: 24, minFailures: 10, minAccounts: 3 },
    recommendation:
      'Human security review: assess intent. Any containment (rate limit, WAF rule, IP block) goes through the existing authorized infrastructure workflow with approval — this module only reports.',
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['ip'],
  },
  {
    code: 'ACC_NEW_GEO_LOGIN',
    name: 'Successful login from a country the account has never used',
    description:
      "A login_success whose IP resolves (via the platform's own geoip-lite lookup, src/visitor-intelligence/geo.ts) to a country absent from the account's baseline of previously seen countries. Carries a GEO_UNAVAILABLE data-quality flag when the IP cannot be resolved, and NO_LOGIN_BASELINE when the account has no prior login history.",
    category: 'account_security',
    family: 'account_auth',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: { baselineDays: 90 },
    recommendation:
      'Ask the customer whether the login was them (travel, VPN, new location are all common and innocent). Escalate only if it coincides with ACC_CONTEXT_CHANGE_AFTER_NEW_LOGIN or ACC_MFA_TAMPERING.',
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_NEW_DEVICE_LOGIN',
    name: 'New or unexpected device / session activity',
    description:
      "A login_success whose classified client family (browser family + OS family, derived by the platform's own classifier — no raw user-agent is copied into this module) is absent from the account's baseline. Device fingerprints are NOT available on this platform; this is a coarse family comparison and the assessment says so.",
    category: 'account_security',
    family: 'account_auth',
    version: 1,
    enabled: true,
    weight: 10,
    severity: 'medium',
    parameters: { baselineDays: 90 },
    recommendation:
      'Confirm with the customer. A browser or OS upgrade produces this legitimately; treat it as context for other signals, not as a finding on its own.',
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_IMPOSSIBLE_TRAVEL',
    name: 'Two successful logins too far apart too quickly',
    description:
      'Two login_success events from different resolved countries within `maxHours`, where the great-circle distance between the GeoIP city centres implies a speed above `maxSpeedKmh`. Deterministic haversine arithmetic on coordinates the platform already derives; no external service is called.',
    category: 'account_security',
    family: 'account_auth',
    version: 1,
    enabled: true,
    weight: 18,
    severity: 'high',
    parameters: { maxHours: 6, maxSpeedKmh: 900 },
    recommendation:
      "One of the two sessions is not the account owner, or one is a VPN/proxy exit. Review both sessions' activity, then use the existing recovery workflow if the customer disowns one. GeoIP is city-centre accuracy — verify before acting.",
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_ACCESS_FREQUENCY_ANOMALY',
    name: 'Abnormal account access frequency',
    description:
      "login_success events in the last `windowHours` exceed `multiplier` times the account's own baseline rate, and the baseline itself has at least `minBaselineSessions` sessions so a brand-new account is not compared against nothing.",
    category: 'account_security',
    family: 'account_auth',
    version: 1,
    enabled: true,
    weight: 8,
    severity: 'low',
    parameters: { windowHours: 1, multiplier: 5, minBaselineSessions: 10 },
    recommendation:
      'Usually automation, a shared login, or a stuck client re-authenticating. Confirm with the customer before treating it as compromise.',
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_RECOVERY_REQUEST_BURST',
    name: 'Suspicious password / account recovery activity volume',
    description:
      'Counts password_reset_requested, email_verification_requested and account_recovery_requested events for the account in the window. Repeated recovery requests are either a locked-out owner or an attacker probing the reset path.',
    category: 'account_security',
    family: 'account_recovery',
    version: 1,
    enabled: true,
    weight: 14,
    severity: 'medium',
    parameters: { windowHours: 24, threshold: 3 },
    recommendation:
      'Check whether any request was completed (password_reset_completed / account_recovery_approved) and from which IP. The existing recovery workflow already requires identity verification and human approval — confirm that path was followed.',
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_RECOVERY_AFTER_FAILURES',
    name: 'Account recovery completed straight after failed logins',
    description:
      'A password_reset_completed or account_recovery_approved within `windowMinutes` of at least `minFailures` login_failure rows. The classic takeover sequence: guess, fail, reset, succeed.',
    category: 'account_security',
    family: 'account_recovery',
    version: 1,
    enabled: true,
    weight: 20,
    severity: 'high',
    parameters: { windowMinutes: 60, minFailures: 3 },
    recommendation:
      'Treat as a possible takeover until the customer confirms otherwise. Review every action taken in the session after the reset. Password changes already invalidate prior sessions (auth_session_version); verify that happened.',
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_STEP_UP_VERIFICATION_FAILURES',
    name: 'Step-up verification failures (MFA / Security PIN)',
    description:
      'Counts mfa_login_failure, security_pin_view_verification_failed and security_number_verification_failed events in the window. Failing a second factor repeatedly means someone holds the password but not the second factor.',
    category: 'account_security',
    family: 'account_recovery',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: { windowHours: 24, threshold: 3 },
    recommendation:
      'Confirm with the customer. If the password is compromised but the second factor held, the credential — not the account — is the exposure. Rotation goes through the existing security workflow.',
    // The step-up CHALLENGE tables are deliberately not listed: this rule reads the
    // auth_audit_log / audit_logs events those flows already write, and naming a table the detector
    // never queries would tell a reviewer the evidence comes from somewhere it does not.
    dataSources: ['auth_audit_log', 'audit_logs', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_CONTEXT_CHANGE_AFTER_NEW_LOGIN',
    name: 'Account information changed right after an unfamiliar login',
    description:
      'profile_update, username_changed, password_change or an email change within `windowMinutes` of a login that ACC_NEW_GEO_LOGIN or ACC_NEW_DEVICE_LOGIN would flag. Correlating the two is what separates an owner updating their profile from an attacker locking the owner out.',
    category: 'account_security',
    family: 'account_change',
    version: 1,
    enabled: true,
    weight: 16,
    severity: 'high',
    parameters: { windowMinutes: 30 },
    recommendation:
      'Contact the customer through the pre-change contact details. If they disown the change, revert it through the existing authorized account workflow with the change on record.',
    dataSources: ['auth_audit_log', 'users', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_MFA_TAMPERING',
    name: 'Second factor removed or rotated after unfamiliar access',
    description:
      'mfa_disabled, passkey_removed or security_pin_rotated within `windowMinutes` of an unfamiliar-context login or of repeated login failures. Removing the second factor is the step that turns a compromised password into a taken-over account.',
    category: 'account_security',
    family: 'account_change',
    version: 1,
    enabled: true,
    weight: 22,
    severity: 'critical',
    parameters: { windowMinutes: 60 },
    recommendation:
      'Highest-priority account-security review. Verify with the customer immediately; if unconfirmed, follow the existing account-recovery workflow. This module does not suspend the account or revoke the session itself.',
    dataSources: ['auth_audit_log', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'actor'],
  },
  {
    code: 'ACC_SHARED_REGISTRATION_CLUSTER',
    name: 'Multiple accounts registered from one source',
    description:
      "For an IP subject: at least `threshold` auth_audit_log 'register' events from the same ip_address in the window, and the distinct customer accounts they created. Bulk registration from one source precedes payment fraud and free-trial abuse.",
    category: 'account_security',
    family: 'account_cluster',
    version: 1,
    enabled: true,
    weight: 16,
    severity: 'high',
    parameters: { windowHours: 24, threshold: 3 },
    recommendation:
      'Review the registered accounts as a group, not individually: shared payment instrument, shared contact details, or shared ordering pattern. NAT and corporate proxies produce this innocently — verify before acting.',
    dataSources: ['auth_audit_log', 'users', 'fraud_sentinel_events'],
    appliesTo: ['ip'],
  },

  /* ========================= C. Order and service abuse ============================== */
  {
    code: 'ORD_ORDER_VELOCITY',
    name: 'Unusual hosting / VPS order velocity',
    description:
      'Count of orders created by the customer in the window above the threshold. Legitimate buyers place a handful of orders; a burst suggests either an automated client or an account being used to farm resources.',
    category: 'order_service',
    family: 'order_velocity',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: { windowHours: 24, threshold: 5 },
    recommendation:
      'Check whether the orders were paid, and whether the resulting services were actually used. Unpaid bursts are usually a broken client; paid bursts need a customer conversation.',
    dataSources: ['orders', 'order_items', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'ORD_REPEAT_IDENTICAL_PURCHASE',
    name: 'Suspicious repeated identical service purchases',
    description:
      'At least `threshold` orders in the window containing the same product and plan snapshot (order_items.product_name_snapshot + plan_name_snapshot + billing_period). Buying the same VPS plan repeatedly is a resource-farming pattern.',
    category: 'order_service',
    family: 'order_velocity',
    version: 1,
    enabled: true,
    weight: 14,
    severity: 'medium',
    parameters: { windowDays: 7, threshold: 3 },
    recommendation:
      'Ask what the repeated identical services are for. Resellers do this legitimately — confirm the account is a reseller before escalating.',
    dataSources: ['orders', 'order_items', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'ORD_HIGH_VALUE_NEW_ACCOUNT',
    name: 'High-value order from a brand-new account',
    description:
      'An order whose total_amount is at least `minAmount` placed while the account is younger than `accountAgeHours`. The single most reliable hosting-fraud pattern: register, buy big, disappear with the resource.',
    category: 'order_service',
    family: 'order_value',
    version: 1,
    enabled: true,
    weight: 22,
    severity: 'critical',
    parameters: { accountAgeHours: 72, minAmount: '500.00' },
    recommendation:
      'Verify identity and payment ownership BEFORE provisioning. Hold delivery through the existing order/provisioning workflow — this module does not and must not block the order itself. Correlate with ACC_NEW_GEO_LOGIN and ACC_SHARED_REGISTRATION_CLUSTER.',
    dataSources: ['orders', 'users', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'ORD_UNPAID_ACCUMULATION',
    name: 'Accumulating unpaid or failed orders',
    description:
      'Count of orders in the window with payment_status unpaid or failed above the threshold. Ordering capacity without paying is abuse of the checkout path and a precursor to service abuse.',
    category: 'order_service',
    family: 'order_value',
    version: 1,
    enabled: true,
    weight: 10,
    severity: 'medium',
    parameters: { windowDays: 30, threshold: 5 },
    recommendation:
      "Distinguish a customer in difficulty (Revenue Guardian's job) from an account farming unpaid orders (this module's job) by whether any service was ever delivered.",
    dataSources: ['orders', 'invoices', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'ORD_PROVISIONING_BURST',
    name: 'Abnormal provisioning request volume',
    description:
      "Count of provisioning_jobs rows linked to the customer's orders in the window above the threshold. One event per job row — retries increment that row's own attempts counter, so a job retried to its maximum still counts once and the attempt count is carried in the evidence. A burst of PROVISION/REINSTALL/DELETE operations is either an automation fault or someone churning infrastructure.",
    category: 'order_service',
    family: 'service_abuse',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: { windowHours: 24, threshold: 5 },
    recommendation:
      'Read provisioning_jobs.operation and .status for the burst. Repeated FAILED + retry is an infrastructure fault; repeated DELETE + PROVISION is churn and needs a provider-cost look.',
    dataSources: ['provisioning_jobs', 'orders', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'ORD_CANCEL_REFUND_PATTERN',
    name: 'Abnormal cancellation and refund pattern',
    description:
      "At least `minCancellations` customer_services rows moved to 'cancelled' together with at least `minRefunds` recorded refunds in the window. Buy, use, cancel, refund is a service-abuse cycle.",
    category: 'order_service',
    family: 'service_abuse',
    version: 1,
    enabled: true,
    weight: 16,
    severity: 'high',
    parameters: { windowDays: 30, minCancellations: 2, minRefunds: 1 },
    recommendation:
      'Check whether the service was consumed between activation and cancellation (usage evidence lives with the service, not here). Refund policy decisions stay in the existing authorized workflow.',
    dataSources: ['customer_services', 'billing_ledger', 'orders', 'fraud_sentinel_events'],
    appliesTo: ['customer'],
  },
  {
    code: 'SVC_TOOL_ABUSE',
    name: 'Recorded service/tool abuse events',
    description:
      'Counts tool_abuse_events rows attributed to the customer or to the IP subject in the window. This is the ONE service-usage abuse signal with genuine per-actor telemetry on this platform; SMTP-relay and proxy abuse have no such telemetry and are deliberately NOT detected (docs/FRAUD_SENTINEL.md §3).',
    category: 'order_service',
    family: 'service_abuse',
    version: 1,
    enabled: true,
    weight: 14,
    severity: 'medium',
    parameters: { windowDays: 7, threshold: 3 },
    recommendation:
      'Read tool_abuse_events.kind and .detail for the recorded abuse. Rate limiting and tool disabling belong to the Tools Center admin workflow, not to this module.',
    dataSources: ['tool_abuse_events', 'fraud_sentinel_events'],
    appliesTo: ['customer', 'ip'],
  },

  /* ====================== D. Administrative and API activity ========================= */
  {
    code: 'ADM_PRIVILEGED_ACTION_BURST',
    name: 'Unusual volume of privileged administrative actions',
    description:
      'Count of audit_logs rows written by one actor in the window above the threshold. A burst of privileged actions is either a migration in progress or an account being used to change many things quickly.',
    category: 'admin_api',
    family: 'admin_activity',
    version: 1,
    enabled: true,
    weight: 14,
    severity: 'medium',
    parameters: { windowHours: 1, threshold: 25 },
    recommendation:
      'Read the audit_logs actions in the burst and confirm the actor was doing authorized work. Insider risk is reviewed by a second administrator, never by the actor.',
    dataSources: ['audit_logs', 'fraud_sentinel_events'],
    appliesTo: ['actor'],
  },
  {
    code: 'ADM_PERMISSION_CHANGE',
    name: 'Unexpected permission or account-status change',
    description:
      'An auth_audit_log admin_role_change or admin_status_change event in the window. Privilege changes are rare and always worth a second pair of eyes, including when they are legitimate.',
    category: 'admin_api',
    family: 'admin_activity',
    version: 1,
    enabled: true,
    weight: 14,
    severity: 'high',
    parameters: { windowHours: 24, threshold: 1 },
    recommendation:
      'Confirm the change was requested and approved by a super_admin. Role changes go through the existing role service, which writes both users.role and user_roles in one transaction — verify both were written.',
    dataSources: ['auth_audit_log', 'users', 'fraud_sentinel_events'],
    appliesTo: ['actor'],
  },
  {
    code: 'ADM_PERMISSION_CHANGE_BURST',
    name: 'Multiple permission changes in a short window',
    description:
      'At least `threshold` admin_role_change / admin_status_change events by one actor in the window. Mass privilege manipulation is how an insider or a compromised admin account establishes persistence.',
    category: 'admin_api',
    family: 'admin_activity',
    version: 1,
    enabled: true,
    weight: 22,
    severity: 'critical',
    parameters: { windowHours: 24, threshold: 3 },
    recommendation:
      'Escalate to a second super_admin immediately and review every affected account. Super-admin-only configuration must stay protected; this module reports and never changes a role itself.',
    dataSources: ['auth_audit_log', 'users', 'fraud_sentinel_events'],
    appliesTo: ['actor'],
  },
  {
    code: 'ADM_STAFF_AUTH_FAILURES',
    name: 'Repeated authentication failures on a privileged account',
    description:
      'login_failure events targeting an account whose users.role is staff, admin or super_admin. Privileged accounts are the highest-value target on the platform, so the same volume that is noise on a customer account is a finding here.',
    category: 'admin_api',
    family: 'admin_activity',
    version: 1,
    enabled: true,
    weight: 16,
    severity: 'high',
    parameters: { windowHours: 24, threshold: 3 },
    recommendation:
      'Verify with the administrator directly. If the failures are unexplained, review every audit_logs action by that actor since the first failure.',
    dataSources: ['auth_audit_log', 'users', 'fraud_sentinel_events'],
    appliesTo: ['actor'],
  },
  {
    code: 'ADM_SUPPORT_SESSION_FANOUT',
    name: 'Delegated support sessions opened across many customers',
    description:
      'At least `threshold` admin_support_sessions opened by one administrator, spanning at least `minDistinctCustomers` distinct customers, in the window. Delegated access is legitimate one customer at a time; a fan-out is not.',
    category: 'admin_api',
    family: 'admin_activity',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: { windowHours: 24, threshold: 5, minDistinctCustomers: 3 },
    recommendation:
      'Ask the administrator what the sweep was for. Each session row records a reason — check it was given. Session tokens are already single-use and expire; no action here changes that.',
    dataSources: ['admin_support_sessions', 'fraud_sentinel_events'],
    appliesTo: ['actor'],
  },
  {
    code: 'ADM_OFF_HOURS_SENSITIVE',
    name: 'Sensitive administrative action outside configured hours',
    description:
      "A sensitive audit_logs action (credentials, settings, provider configuration, roles, secrets) whose occurred_at hour in UTC falls inside the configured off-hours band. DATA-QUALITY NOTE: the band is evaluated in UTC because the platform stores timestamptz and the module does not know the actor's timezone; the flag says so rather than pretending to local time.",
    category: 'admin_api',
    family: 'admin_activity',
    version: 1,
    enabled: true,
    weight: 8,
    severity: 'low',
    parameters: { startHourUtc: 22, endHourUtc: 6 },
    recommendation:
      'Confirm the actor was working late rather than someone using their session. Off-hours alone is weak evidence — only meaningful next to another signal.',
    dataSources: ['audit_logs', 'fraud_sentinel_events'],
    appliesTo: ['actor'],
  },
  {
    code: 'ADM_SENSITIVE_CONFIG_CHANGE',
    name: 'Unusual changes to sensitive configuration',
    description:
      'Count of audit_logs rows in the window whose resource_type or action matches the documented sensitive list actually used by this codebase (platform_settings, marketing_integration, domain_service_provider, cloudflare_account, tool_provider, ssh_key, server credentials, and actions containing credentials/configuration_saved/settings.updated/policy_updated/secret).',
    category: 'admin_api',
    family: 'admin_activity',
    version: 1,
    enabled: true,
    weight: 12,
    severity: 'medium',
    parameters: { windowDays: 7, threshold: 3 },
    recommendation:
      'Review each configuration change against its approval. Provider credentials and webhook secrets are the highest-impact items — confirm rotation was authorized.',
    dataSources: ['audit_logs', 'fraud_sentinel_events'],
    appliesTo: ['actor'],
  },
  {
    code: 'ADM_MANUAL_PAYMENT_BURST',
    name: 'Manual payment confirmations by one administrator',
    description:
      'At least `threshold` auth_audit_log manual_payment_confirmed events by one actor in the window. Manual confirmation is the one place a human can mark money as received without a gateway, so a burst is a direct financial-control risk.',
    category: 'admin_api',
    family: 'admin_activity',
    version: 1,
    enabled: true,
    weight: 20,
    severity: 'critical',
    parameters: { windowHours: 24, threshold: 3 },
    recommendation:
      'Reconcile every manual confirmation against the bank/gateway statement through the existing payment-reconciliation workflow. Manual confirmation requires the existing authorization; verify each one had it.',
    dataSources: ['auth_audit_log', 'payments', 'billing_ledger', 'fraud_sentinel_events'],
    appliesTo: ['actor'],
  },
  {
    code: 'API_WEBHOOK_REJECT_BURST',
    name: 'Burst of rejected or failed webhook deliveries',
    description:
      'For a gateway subject: at least `threshold` webhook_events rows with status rejected or failed in the window. Rejected deliveries mean signature failures, malformed payloads, or someone probing the webhook endpoint.',
    category: 'admin_api',
    family: 'webhook_integrity',
    version: 1,
    enabled: true,
    weight: 16,
    severity: 'high',
    parameters: { windowHours: 1, threshold: 5 },
    recommendation:
      'Check webhook_events.event_type and error-free rejection counts at the gateway. Signature verification is already enforced in src/payments/webhook-signing.ts; a burst means the endpoint is being attacked or a provider changed shape.',
    dataSources: ['webhook_events', 'fraud_sentinel_events'],
    appliesTo: ['gateway'],
  },
  {
    code: 'API_WEBHOOK_REPLAY',
    name: 'Webhook payload replay attempts',
    description:
      'For a gateway subject: the same webhook_events.payload_hash recorded on at least `threshold` distinct webhook_events rows in the window. HONEST SCOPE: src/routes/webhooks.ts verifies the signature BEFORE any row is written, and UNIQUE(gateway, event_id) stops a re-delivered event id creating a second row — so a byte-identical replay of the SAME event id is refused without leaving a row here and is NOT visible to this rule. What it does see is one payload recorded under several distinct event ids: a provider retry storm, a re-signed replay, or an attacker able to produce valid signatures for new event ids.',
    category: 'admin_api',
    family: 'webhook_integrity',
    version: 1,
    enabled: true,
    weight: 20,
    severity: 'critical',
    parameters: { windowHours: 1, threshold: 3 },
    recommendation:
      'Compare the event_ids sharing the payload hash. If they are provider retries, nothing is wrong. If they are not, treat it as an attack on the payment webhook: confirm signature verification is enabled for the gateway and rotate the webhook secret through the existing authorized configuration workflow. Signature-rejected deliveries are refused before any row is written, so their absence here is not evidence of absence — check the application log.',
    dataSources: ['webhook_events', 'fraud_sentinel_events'],
    appliesTo: ['gateway'],
  },
];

/** Lookup by code. */
export const RULE_BY_CODE: ReadonlyMap<string, RuleDefinition> = new Map(
  RULE_CATALOGUE.map((rule) => [rule.code, rule])
);

export function findRuleDefinition(code: string): RuleDefinition | undefined {
  return RULE_BY_CODE.get(code);
}

/** Sanity assertions run at module load in development/test so a bad catalogue edit fails loudly. */
const CODES = RULE_CATALOGUE.map((r) => r.code);
if (new Set(CODES).size !== CODES.length) {
  throw new Error('fraud-sentinel rule catalogue contains a duplicate code');
}
for (const rule of RULE_CATALOGUE) {
  if (!/^[A-Z][A-Z0-9_]{2,47}$/.test(rule.code)) {
    throw new Error(`fraud-sentinel rule code is malformed: ${rule.code}`);
  }
  if (!RULE_FAMILIES.includes(rule.family)) {
    throw new Error(`fraud-sentinel rule ${rule.code} uses an undeclared family: ${rule.family}`);
  }
  if (rule.weight < 0 || rule.weight > 100) {
    throw new Error(`fraud-sentinel rule ${rule.code} has an out-of-range weight: ${rule.weight}`);
  }
  if (rule.appliesTo.length === 0) {
    throw new Error(`fraud-sentinel rule ${rule.code} applies to no subject type`);
  }
  if (rule.dataSources.length === 0) {
    throw new Error(`fraud-sentinel rule ${rule.code} declares no data source`);
  }
}
