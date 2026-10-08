/**
 * The Copilot's data layer — the platform's replacement for the audited build's tool registry.
 *
 * Every function here answers from **rows that exist**. None of them invents a value, an average, a
 * trend or a "likely" figure: a query with no rows returns zero rows, and a derived number is either
 * a sum/count of stored columns or is absent. This is the layer that makes the Copilot's "I will not
 * guess" promise mechanical rather than a matter of good intentions.
 *
 * Each call returns an **outcome envelope**, which is how the router formats and records evidence:
 *
 *   `{ status: 'executed', data }`  — the query ran; `data` may legitimately be empty
 *   `{ status: 'failed', errorCode, message }` — the query could not run, and nothing is claimed
 *
 * Thresholds are named constants and are echoed into the answers that use them, so an operator can
 * always see *why* a row was flagged rather than trusting a number that appeared from nowhere.
 */
'use strict';

const { uuidv7 } = require('./ids');

/** Server-health flags. Documented in every answer that reports them. */
const SERVER_HEALTH_THRESHOLDS = Object.freeze({
  cpuPercent: 90,
  memoryPercent: 90,
  diskPercent: 90,
  staleMetricsMinutes: 15,
});

/** What "unresolved" means for a support ticket, in one place. */
const OPEN_TICKET_STATUSES = Object.freeze(['open', 'pending']);

function executed(data) {
  return { status: 'executed', data };
}

function failed(errorCode, message) {
  return { status: 'failed', errorCode, message };
}

/** Wrap a query so an unexpected store error becomes an honest refusal instead of a 500. */
async function guard(run) {
  try {
    return executed(await run());
  } catch (error) {
    return failed('QUERY_FAILED', error instanceof Error ? error.message : String(error));
  }
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const iso = (value) => (value ? new Date(value).toISOString() : null);
const ageHours = (value, now) => Math.max(0, Math.round((now - new Date(value).getTime()) / 3_600_000));
const ageMinutes = (value, now) => Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
const daysUntil = (value, now) => Math.ceil((new Date(value).getTime() - now) / 86_400_000);

/** One read of `users`, keyed by id, so a list of rows can name its customers without N queries. */
async function emailIndex(store, userIds) {
  const wanted = new Set(userIds.filter(Boolean));
  if (wanted.size === 0) return new Map();
  const rows = await store.table('users').all();
  return new Map(rows.filter((row) => wanted.has(row.id)).map((row) => [row.id, row.email]));
}

// ============================================================================ admin queries

/** Payment attempts the gateway refused, in the window. Real rows, with the reason that was recorded. */
async function listFailedPayments(store, { days = 1, now = Date.now() } = {}) {
  return guard(async () => {
    const since = now - days * 86_400_000;
    const statuses = new Set(['failed', 'rejected', 'declined']);
    const rows = (await store.table('payments').all())
      .filter((row) => statuses.has(String(row.status ?? '').toLowerCase()) && new Date(row.created_at).getTime() >= since)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const emails = await emailIndex(store, rows.map((row) => row.user_id));
    return {
      payments: rows.map((row) => ({
        paymentId: row.id,
        customerEmail: emails.get(row.user_id) ?? null,
        amount: row.amount,
        currency: row.currency ?? 'USD',
        gateway: row.gateway ?? null,
        failureReason: row.rejection_reason ?? row.metadata?.failureReason ?? null,
        createdAt: iso(row.created_at),
      })),
      count: rows.length,
      statusesCounted: [...statuses],
    };
  });
}

/** Unpaid invoices past their due date. `daysOverdue` is computed from the stored due date. */
async function listOverdueInvoices(store, { limit = 50, now = Date.now() } = {}) {
  return guard(async () => {
    const rows = (await store.table('invoices').all())
      .filter((row) => String(row.status ?? '').toLowerCase() === 'unpaid')
      .filter((row) => row.due_at && new Date(row.due_at).getTime() < now)
      .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
      .slice(0, limit);
    const emails = await emailIndex(store, rows.map((row) => row.user_id));
    return {
      invoices: rows.map((row) => ({
        invoiceNumber: row.number,
        customerEmail: emails.get(row.user_id) ?? null,
        total: Number(row.total ?? 0),
        amountDue: Number(row.total ?? 0) - Number(row.amount_paid ?? 0),
        currency: row.currency ?? 'USD',
        dueDate: iso(row.due_at),
        daysOverdue: ageHours(row.due_at, now) / 24 > 0 ? Math.floor((now - new Date(row.due_at).getTime()) / 86_400_000) : 0,
      })),
      count: rows.length,
    };
  });
}

/**
 * Servers with a health flag.
 *
 * Flags come from the newest stored metric per server plus the server's own status. A server whose
 * newest metric is older than `staleMetricsMinutes` is flagged `stale_metrics` — "we have not heard
 * from it" is itself a finding, and reporting the old numbers as current would not be.
 */
async function listServerHealth(store, { limit = 100, now = Date.now() } = {}) {
  return guard(async () => {
    const servers = await store.table('servers').all();
    const metrics = await store.table('server_metrics').all();
    const latest = new Map();
    for (const metric of metrics) {
      const previous = latest.get(metric.server_id);
      if (!previous || String(metric.collected_at) > String(previous.collected_at)) latest.set(metric.server_id, metric);
    }

    const rows = servers.map((server) => {
      const metric = latest.get(server.id) ?? null;
      const flags = [];
      if (metric) {
        if (Number(metric.cpu_percent) >= SERVER_HEALTH_THRESHOLDS.cpuPercent) flags.push('high_cpu');
        if (Number(metric.memory_percent) >= SERVER_HEALTH_THRESHOLDS.memoryPercent) flags.push('high_memory');
        if (Number(metric.disk_percent) >= SERVER_HEALTH_THRESHOLDS.diskPercent) flags.push('high_disk');
        const staleness = ageMinutes(metric.collected_at, now);
        if (staleness > SERVER_HEALTH_THRESHOLDS.staleMetricsMinutes) flags.push('stale_metrics');
      } else {
        flags.push('no_metrics');
      }
      const status = String(server.status ?? '').toLowerCase();
      if (['degraded', 'error', 'suspended', 'failed'].includes(status)) flags.push(`status_${status}`);
      return {
        id: server.id, hostname: server.hostname ?? server.name, status: server.status ?? null,
        cpuPercent: metric ? metric.cpu_percent ?? null : null,
        memoryPercent: metric ? metric.memory_percent ?? null : null,
        diskPercent: metric ? metric.disk_percent ?? null : null,
        lastMetricAt: metric ? iso(metric.collected_at) : null,
        flags,
      };
    }).slice(0, limit);

    return {
      servers: rows,
      count: rows.length,
      flaggedCount: rows.filter((row) => row.flags.length > 0).length,
      thresholds: { ...SERVER_HEALTH_THRESHOLDS },
    };
  });
}

/** Unresolved tickets, oldest first — the queue as it actually stands. */
async function listOpenTickets(store, { limit = 30, now = Date.now() } = {}) {
  return guard(async () => {
    const rows = (await store.table('support_tickets').all())
      .filter((row) => OPEN_TICKET_STATUSES.includes(String(row.status ?? '').toLowerCase()))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(0, limit);
    const emails = await emailIndex(store, rows.map((row) => row.user_id));
    return {
      tickets: rows.map((row) => ({
        id: row.id, reference: row.reference ?? null, subject: row.subject,
        customerEmail: emails.get(row.user_id) ?? null,
        status: row.status, priority: row.priority ?? null, department: row.department ?? null,
        ageHours: ageHours(row.created_at, now), createdAt: iso(row.created_at),
      })),
      count: rows.length,
      statusesCounted: [...OPEN_TICKET_STATUSES],
    };
  });
}

/**
 * Subscriptions that are past due or set to cancel.
 *
 * `pastDueSince` is a stored column, so it is reported; there is no inferred "churn score", because
 * a score would be a guess with a number attached to it.
 */
async function listSubscriptionRisk(store, { now = Date.now() } = {}) {
  return guard(async () => {
    const rows = await store.table('subscriptions').all();
    const risk = rows.filter((row) => {
      const status = String(row.status ?? '').toLowerCase();
      return status === 'past_due' || row.cancel_at_period_end === true;
    });
    const emails = await emailIndex(store, risk.map((row) => row.user_id));
    const subscriptions = risk.map((row) => ({
      id: row.id,
      customerEmail: emails.get(row.user_id) ?? null,
      planId: row.plan_id ?? null,
      status: row.status,
      pastDueSince: iso(row.past_due_since),
      cancelAtPeriodEnd: row.cancel_at_period_end === true,
      currentPeriodEnd: iso(row.current_period_end ?? row.renews_at),
    }));
    return {
      subscriptions,
      pastDue: subscriptions.filter((row) => String(row.status).toLowerCase() === 'past_due'),
      pendingCancellation: subscriptions.filter((row) => row.cancelAtPeriodEnd),
      totalActive: rows.filter((row) => String(row.status ?? '').toLowerCase() === 'active').length,
      asOf: new Date(now).toISOString(),
    };
  });
}

/** Deployments and provisioning jobs that have sat in a non-terminal state too long. */
async function listStuckDeployments(store, { minutes = 60, now = Date.now() } = {}) {
  return guard(async () => {
    const cutoff = now - minutes * 60_000;
    const live = new Set(['queued', 'running', 'pending', 'in_progress']);

    const deployments = (await store.table('deployments').all())
      .filter((row) => live.has(String(row.status ?? '').toLowerCase()) && new Date(row.created_at).getTime() <= cutoff)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((row) => ({
        id: row.id, ref: row.ref ?? null, action: row.action ?? row.type ?? 'deployment',
        serverId: row.server_id ?? null, status: row.status,
        ageMinutes: ageMinutes(row.created_at, now), attempts: row.attempts ?? 0,
        maxAttempts: row.max_attempts ?? null, runAfter: iso(row.run_after),
      }));

    const jobs = (await store.table('provisioning_jobs').all())
      .filter((row) => live.has(String(row.status ?? '').toLowerCase()) && new Date(row.created_at).getTime() <= cutoff)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((row) => ({
        id: row.id, kind: row.kind ?? row.type ?? 'job', resourceType: row.resource_type ?? null,
        resourceId: row.resource_id ?? null, serverId: row.server_id ?? null, status: row.status,
        ageMinutes: ageMinutes(row.created_at, now), attempts: row.attempts ?? 0,
      }));

    return { deployments, jobs, thresholdMinutes: minutes, asOf: new Date(now).toISOString() };
  });
}

/** Deployments that ended in failure, with the error that was recorded. */
async function listFailedDeployments(store, { days = 1, now = Date.now() } = {}) {
  return guard(async () => {
    const since = now - days * 86_400_000;
    const rows = (await store.table('deployments').all())
      .filter((row) => String(row.status ?? '').toLowerCase() === 'failed'
        && new Date(row.completed_at ?? row.updated_at ?? row.created_at).getTime() >= since)
      .sort((a, b) => String(b.completed_at ?? b.updated_at ?? b.created_at).localeCompare(String(a.completed_at ?? a.updated_at ?? a.created_at)));
    const servers = new Map((await store.table('servers').all()).map((server) => [server.id, server]));
    return {
      deployments: rows.map((row) => ({
        id: row.id, action: row.action ?? row.type ?? 'deployment',
        serverHostname: servers.get(row.server_id)?.hostname ?? null,
        serverId: row.server_id ?? null,
        errorCode: row.error_code ?? null,
        errorMessage: row.error_message ?? null,
        attempts: row.attempts ?? 0,
        completedAt: iso(row.completed_at ?? row.updated_at),
      })),
      count: rows.length,
    };
  });
}

/** Certificates expiring inside the window, or already in a failed state. */
async function listExpiringSsl(store, { days = 30, userId = null, now = Date.now() } = {}) {
  return guard(async () => {
    const rows = (await store.table('ssl_certificates').all())
      .filter((row) => !userId || row.user_id === userId)
      .filter((row) => {
        if (String(row.status ?? '').toLowerCase() === 'failed') return true;
        if (!row.expires_at) return false;
        return new Date(row.expires_at).getTime() - now <= days * 86_400_000;
      })
      .sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)));
    const emails = await emailIndex(store, rows.map((row) => row.user_id));
    return {
      certificates: rows.map((row) => ({
        id: row.id, domainName: row.domain_name,
        customerEmail: emails.get(row.user_id) ?? null,
        status: row.status ?? null,
        expiresAt: iso(row.expires_at),
        daysUntilExpiry: row.expires_at ? daysUntil(row.expires_at, now) : null,
        autoRenew: row.auto_renew === true,
      })),
      count: rows.length,
      windowDays: days,
    };
  });
}

/** Customer-held domains expiring inside the window. */
async function listExpiringDomains(store, { days = 30, userId = null, now = Date.now() } = {}) {
  return guard(async () => {
    const rows = (await store.table('customer_domains').all())
      .filter((row) => !userId || row.user_id === userId)
      .filter((row) => row.expires_at && new Date(row.expires_at).getTime() - now <= days * 86_400_000)
      .sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)));
    const emails = await emailIndex(store, rows.map((row) => row.user_id));
    return {
      domains: rows.map((row) => ({
        id: row.id, domainName: row.domain, customerEmail: emails.get(row.user_id) ?? null,
        registrar: row.registrar ?? null, expiresAt: iso(row.expires_at),
        daysUntilExpiry: daysUntil(row.expires_at, now), autoRenew: row.auto_renew === true,
      })),
      count: rows.length,
      windowDays: days,
    };
  });
}

/**
 * Authentication anomaly clusters from `auth_audit_log` — counts of *recorded failures*, clustered by
 * source IP and by account. A cluster is not an accusation: it is a count of rows, and the answer
 * says so.
 */
async function listAuthAnomalies(store, { hours = 24, now = Date.now(), ipThreshold = 5, accountThreshold = 3 } = {}) {
  return guard(async () => {
    const since = now - hours * 3_600_000;
    const failureTypes = /fail|denied|locked|invalid|blocked/i;
    const rows = (await store.table('auth_audit_log').all())
      .filter((row) => failureTypes.test(String(row.event_type ?? '')) && new Date(row.created_at).getTime() >= since);

    const byIp = new Map();
    const byUser = new Map();
    for (const row of rows) {
      if (row.ip_address) {
        const entry = byIp.get(row.ip_address) ?? { ipAddress: row.ip_address, failures: 0, accounts: new Set() };
        entry.failures += 1;
        if (row.user_id) entry.accounts.add(row.user_id);
        byIp.set(row.ip_address, entry);
      }
      if (row.user_id) {
        const entry = byUser.get(row.user_id) ?? { userId: row.user_id, failures: 0, ips: new Set() };
        entry.failures += 1;
        if (row.ip_address) entry.ips.add(row.ip_address);
        byUser.set(row.user_id, entry);
      }
    }

    const emails = await emailIndex(store, [...byUser.keys()]);
    return {
      ipClusters: [...byIp.values()]
        .filter((entry) => entry.failures >= ipThreshold)
        .map((entry) => ({ ipAddress: entry.ipAddress, failures: entry.failures, accountsTargeted: entry.accounts.size }))
        .sort((a, b) => b.failures - a.failures),
      accountClusters: [...byUser.values()]
        .filter((entry) => entry.failures >= accountThreshold)
        .map((entry) => ({
          userId: entry.userId, customerEmail: emails.get(entry.userId) ?? null,
          failures: entry.failures, distinctIps: entry.ips.size,
        }))
        .sort((a, b) => b.failures - a.failures),
      windowHours: hours,
      thresholds: { ip: ipThreshold, account: accountThreshold },
      failureEvents: rows.length,
    };
  });
}

/** The AI incident register — the `ai_registry` rows of kind `incident`. */
async function listIncidents(store, { limit = 25 } = {}) {
  return guard(async () => {
    const rows = (await store.table('ai_registry').all())
      .filter((row) => row.kind === 'incident')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
    return {
      incidents: rows.map((row) => ({
        id: row.id, incidentNumber: row.slug, title: row.name, status: row.status,
        severity: row.metadata?.severity ?? null, createdAt: iso(row.created_at),
        notes: asArray(row.metadata?.notes).length,
      })),
      count: rows.length,
    };
  });
}

/**
 * Revenue snapshot, from payment rows and subscription rows — nothing else.
 *
 * `methodology` is returned with the numbers and is printed in the answer, because "revenue" means
 * different things to different people and this figure means exactly one thing: the sum of rows this
 * platform recorded as successful payments.
 */
async function getRevenueSnapshot(store, { now = Date.now() } = {}) {
  return guard(async () => {
    const succeeded = new Set(['succeeded', 'confirmed']);
    const payments = (await store.table('payments').all()).filter((row) => succeeded.has(String(row.status ?? '').toLowerCase()));
    const within = (days) => payments
      .filter((row) => new Date(row.confirmed_at ?? row.created_at).getTime() >= now - days * 86_400_000)
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

    const failed = (await store.table('payments').all())
      .filter((row) => ['failed', 'rejected', 'declined'].includes(String(row.status ?? '').toLowerCase())
        && new Date(row.created_at).getTime() >= now - 30 * 86_400_000);

    const subscriptions = await store.table('subscriptions').all();
    const active = subscriptions.filter((row) => String(row.status ?? '').toLowerCase() === 'active');
    const atRisk = subscriptions.filter((row) => String(row.status ?? '').toLowerCase() === 'past_due');
    const cancelling = subscriptions.filter((row) => row.cancel_at_period_end === true);

    const round2 = (value) => Math.round(value * 100) / 100;
    return {
      successfulPayments: {
        amount1Day: round2(within(1)),
        amount7Days: round2(within(7)),
        amount30Days: round2(within(30)),
        count30d: payments.filter((row) => new Date(row.confirmed_at ?? row.created_at).getTime() >= now - 30 * 86_400_000).length,
      },
      failedPayments: { amount30d: round2(failed.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)), count30d: failed.length },
      subscriptions: { active: active.length, atRisk: atRisk.length, pendingCancellation: cancelling.length },
      methodology: 'sum of payments rows with status succeeded/confirmed, by confirmed_at (created_at when unconfirmed); failed payments counted from rows with status failed/rejected/declined. No projection, no annualisation, no inferred MRR.',
      asOf: new Date(now).toISOString(),
    };
  });
}

/** Everything the overview answer prints, each from its own real query. */
async function getPlatformOverview(store, { now = Date.now() } = {}) {
  return guard(async () => {
    const [users, tickets, invoices, payments, servers, deployments, subscriptions, ssl, domains] = await Promise.all([
      store.table('users').all(),
      listOpenTickets(store, { now }),
      listOverdueInvoices(store, { now }),
      listFailedPayments(store, { days: 1, now }),
      listServerHealth(store, { now }),
      listFailedDeployments(store, { days: 1, now }),
      store.table('subscriptions').all(),
      listExpiringSsl(store, { days: 30, now }),
      listExpiringDomains(store, { days: 30, now }),
    ]);

    if ([tickets, invoices, payments, servers, deployments, ssl, domains].some((outcome) => outcome.status !== 'executed')) {
      return failed('QUERY_FAILED', 'One or more overview queries could not run');
    }

    const unpaid = (await store.table('invoices').all()).filter((row) => String(row.status ?? '').toLowerCase() === 'unpaid');
    return {
      asOf: new Date(now).toISOString(),
      customers: users.filter((row) => row.role === 'customer').length,
      activeCustomers: users.filter((row) => row.role === 'customer' && String(row.status ?? '').toLowerCase() === 'active').length,
      openTickets: tickets.data.count,
      newTickets: tickets.data.tickets.filter((row) => String(row.status).toLowerCase() === 'open').length,
      unpaidInvoices: unpaid.length,
      overdueInvoices: invoices.data.count,
      overdueAmountTotal: Math.round(invoices.data.invoices.reduce((sum, row) => sum + Number(row.amountDue ?? 0), 0) * 100) / 100,
      failedPayments24h: payments.data.count,
      serversActive: servers.data.servers.filter((row) => String(row.status ?? '').toLowerCase() === 'active').length,
      serversDegraded: servers.data.flaggedCount,
      failedDeployments24h: deployments.data.count,
      subscriptionsActive: subscriptions.filter((row) => String(row.status ?? '').toLowerCase() === 'active').length,
      subscriptionsAtRisk: subscriptions.filter((row) => String(row.status ?? '').toLowerCase() === 'past_due' || row.cancel_at_period_end === true).length,
      sslExpiring30d: ssl.data.count,
      domainsExpiring30d: domains.data.count,
    };
  });
}

// ============================================================================ customer queries

/** The asking customer's own balance, subscription and support counts. */
async function getCustomerProfile(store, { userId, now = Date.now() } = {}) {
  return guard(async () => {
    const invoices = (await store.table('invoices').all()).filter((row) => row.user_id === userId);
    const unpaid = invoices.filter((row) => String(row.status ?? '').toLowerCase() === 'unpaid');
    const overdue = unpaid.filter((row) => row.due_at && new Date(row.due_at).getTime() < now);
    const payments = (await store.table('payments').all()).filter((row) => row.user_id === userId);
    const failed = payments.filter((row) => ['failed', 'rejected', 'declined'].includes(String(row.status ?? '').toLowerCase())
      && new Date(row.created_at).getTime() >= now - 30 * 86_400_000);
    const subscriptions = (await store.table('subscriptions').all()).filter((row) => row.user_id === userId);
    const services = (await store.table('customer_services').all()).filter((row) => row.user_id === userId);
    const domains = (await store.table('customer_domains').all()).filter((row) => row.user_id === userId);
    const tickets = (await store.table('support_tickets').all()).filter((row) => row.user_id === userId);

    return {
      userId,
      metrics: {
        servicesActive: services.filter((row) => String(row.status ?? '').toLowerCase() === 'active').length,
        servicesTotal: services.length,
        domainsTotal: domains.length,
        subscriptionsActive: subscriptions.filter((row) => String(row.status ?? '').toLowerCase() === 'active').length,
        subscriptionsAtRisk: subscriptions.filter((row) => String(row.status ?? '').toLowerCase() === 'past_due' || row.cancel_at_period_end === true).length,
        invoicesUnpaid: unpaid.length,
        invoicesOverdue: overdue.length,
        unpaidAmountTotal: Math.round(unpaid.reduce((sum, row) => sum + (Number(row.total ?? 0) - Number(row.amount_paid ?? 0)), 0) * 100) / 100,
        currency: unpaid[0]?.currency ?? 'USD',
        failedPayments30d: failed.length,
        ticketsOpen: tickets.filter((row) => OPEN_TICKET_STATUSES.includes(String(row.status ?? '').toLowerCase())).length,
        ticketsTotal: tickets.length,
      },
      asOf: new Date(now).toISOString(),
    };
  });
}

/** The asking customer's invoices, newest first. */
async function listInvoices(store, { userId, limit = 10 } = {}) {
  return guard(async () => {
    const rows = (await store.table('invoices').all())
      .filter((row) => row.user_id === userId)
      .sort((a, b) => String(b.issued_at ?? b.created_at).localeCompare(String(a.issued_at ?? a.created_at)))
      .slice(0, limit);
    return {
      invoices: rows.map((row) => ({
        id: row.id, invoiceNumber: row.number, totalAmount: Number(row.total ?? 0),
        amountDue: Number(row.total ?? 0) - Number(row.amount_paid ?? 0),
        currency: row.currency ?? 'USD', status: row.status,
        issuedAt: iso(row.issued_at ?? row.created_at), dueDate: iso(row.due_at), paidAt: iso(row.paid_at),
      })),
      count: rows.length,
    };
  });
}

/** The asking customer's subscriptions, with the plan label the row carries. */
async function listCustomerSubscriptions(store, { userId, limit = 10 } = {}) {
  return guard(async () => {
    const rows = (await store.table('subscriptions').all())
      .filter((row) => row.user_id === userId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
    // Plan labels come from the catalog, which is where a subscription's `plan_id` points. A
    // subscription whose plan row is gone reports its id and no name — never an invented label.
    const plans = new Map((await store.table('catalog_product_plans').all()).map((plan) => [plan.id, plan.name]));
    return {
      subscriptions: rows.map((row) => ({
        id: row.id, planId: row.plan_id ?? null, planName: plans.get(row.plan_id) ?? null,
        status: row.status, billingCycle: row.billing_cycle ?? null,
        currentPeriodEnd: iso(row.current_period_end ?? row.renews_at),
        cancelAtPeriodEnd: row.cancel_at_period_end === true,
      })),
      count: rows.length,
    };
  });
}

/** What this platform has recorded about AI activity on the customer's account. */
async function getAiActivity(store, { userId } = {}) {
  return guard(async () => {
    const rows = (await store.table('ai_registry').all()).filter((row) => row.metadata?.userId === userId);
    const byKind = (kind) => rows.filter((row) => row.kind === kind);
    return {
      events: byKind('event').map((row) => ({
        id: row.id, name: row.name, status: row.status,
        intent: row.metadata?.intent ?? null, createdAt: iso(row.created_at),
      })),
      tasks: byKind('task').length,
      findings: byKind('finding').length,
      approvals: byKind('approval').length,
      total: rows.length,
    };
  });
}

/**
 * Words that must never count as a match on their own.
 *
 * Without this, "what is your internal escalation policy ...?" matches an article containing "your"
 * and the assistant answers with that article — which is precisely the failure this module exists to
 * prevent: a confident reply to a question nobody has documentation for. A stopword overlap is not
 * evidence, so it is discarded before scoring rather than weighted down.
 */
const KNOWLEDGE_STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'while', 'with', 'your', 'yours', 'you', 'this', 'that', 'these',
  'those', 'there', 'their', 'them', 'then', 'than', 'have', 'has', 'had', 'does', 'dont', 'doesnt',
  'from', 'into', 'about', 'would', 'could', 'should', 'will', 'shall', 'been', 'being', 'were',
  'also', 'just', 'like', 'some', 'only', 'over', 'under', 'after', 'before', 'here', 'help', 'need',
  'want', 'please', 'account', 'cloudhost247',
]);

/**
 * Search the knowledge base.
 *
 * Titles and bodies only: a match is a substring of a stored article by a word that carries meaning,
 * and the answer cites the article it came from. There is no embedding and no relevance score, so
 * there is nothing here that can be right-sounding yet unfounded — and a question whose words are all
 * stopwords or absent finds nothing, which the caller reports as "I could not find documentation".
 */
async function searchKnowledge(store, { query, limit = 3 } = {}) {
  return guard(async () => {
    const needle = String(query ?? '').trim().toLowerCase();
    if (!needle) return { results: [], count: 0 };
    const words = needle.split(/\s+/)
      .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ''))
      .filter((word) => word.length >= 4 && !KNOWLEDGE_STOPWORDS.has(word));
    if (words.length === 0) return { results: [], count: 0, matchedWords: 0, stoppedWords: true };

    const rows = await store.table('ai_support_knowledge').all();
    const scored = rows.map((row) => {
      const haystack = `${row.title} ${row.body}`.toLowerCase();
      const matched = words.filter((word) => haystack.includes(word));
      return { row, hits: matched.length, matched, exact: haystack.includes(needle) };
    }).filter((entry) => entry.hits > 0)
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.hits - a.hits)
      .slice(0, limit);

    return {
      results: scored.map((entry) => ({
        id: entry.row.id, title: entry.row.title, content: entry.row.body,
        citation: { source: 'ai_support_knowledge', title: entry.row.title },
        matchedWords: entry.matched,
      })),
      count: scored.length,
      matchedWords: words.length,
    };
  });
}

/**
 * Open a support ticket on the customer's own behalf — the one mutation the assistant performs, and
 * only on the customer's explicit request. It writes the same rows the Support section writes
 * (`support_tickets` + `support_ticket_messages`) so it lands in the real queue.
 */
async function createTicket(store, { userId, subject, body }) {
  return guard(async () => {
    const reference = `TCK-${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const ticket = await store.table('support_tickets').insert({
      id: uuidv7(), reference, user_id: userId, subject: subject.slice(0, 200),
      department: 'general', priority: 'normal', status: 'open',
    });
    await store.table('support_ticket_messages').insert({
      id: uuidv7(), ticket_id: ticket.id, author_id: userId, author_role: 'customer',
      body: `Customer request via Cloud Assistant:\n\n${body}`,
    });
    await store.table('support_tickets').updateById(ticket.id, { last_reply_at: new Date().toISOString() });
    return { ticketId: ticket.id, reference: ticket.reference, status: ticket.status };
  });
}

module.exports = {
  SERVER_HEALTH_THRESHOLDS,
  OPEN_TICKET_STATUSES,
  listFailedPayments,
  listOverdueInvoices,
  listServerHealth,
  listOpenTickets,
  listSubscriptionRisk,
  listStuckDeployments,
  listFailedDeployments,
  listExpiringSsl,
  listExpiringDomains,
  listAuthAnomalies,
  listIncidents,
  getRevenueSnapshot,
  getPlatformOverview,
  getCustomerProfile,
  listInvoices,
  listCustomerSubscriptions,
  getAiActivity,
  searchKnowledge,
  createTicket,
};
