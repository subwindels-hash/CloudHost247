import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingApi, catalogApi, describeError } from '../lib/api.js';
import {
  formatDate, formatMoney, humanizeStatus, invoiceBalance, isOverdue, statusClass,
} from '../lib/format.js';

/**
 * Billing overview: invoices, subscriptions and the ledger.
 *
 * Every amount shown here comes from the server; the page never adds up money itself. Cancel is a
 * request for the end of the paid period (the server keeps the subscription active until then), and
 * a plan change is recorded as a request — both are described in plain words so the result is not
 * mistaken for an immediate change.
 */
export default function BillingPage() {
  const [invoices, setInvoices] = useState(null);
  const [subscriptions, setSubscriptions] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [chosenPlan, setChosenPlan] = useState({});

  const load = useCallback(async () => {
    setError('');
    const [inv, subs, led, cat] = await Promise.allSettled([
      billingApi.invoices(),
      billingApi.subscriptions(),
      billingApi.ledger(),
      catalogApi.all(),
    ]);
    if (inv.status === 'fulfilled') setInvoices(inv.value.invoices);
    else { setInvoices([]); setError(describeError(inv.reason)); }
    setSubscriptions(subs.status === 'fulfilled' ? subs.value.subscriptions : []);
    setLedger(led.status === 'fulfilled' ? led.value.ledger : []);
    if (cat.status === 'fulfilled') {
      setPlans(cat.value.products.flatMap((product) => product.plans.map((plan) => ({
        slug: plan.slug, name: plan.name, product: product.name,
      }))));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancelSubscription = async (subscription) => {
    const ok = window.confirm(
      'Cancel this subscription at the end of the current paid period? '
      + 'You keep access until then and will not be charged again.',
    );
    if (!ok) return;
    setError('');
    setMessage('');
    setBusy(subscription.id);
    try {
      const res = await billingApi.cancelSubscription(subscription.id);
      setMessage(res.alreadyCancelled
        ? 'That subscription was already cancelled.'
        : 'Cancellation recorded. It takes effect at the end of the current period.');
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  const requestPlanChange = async (subscription) => {
    const slug = chosenPlan[subscription.id];
    if (!slug) return;
    setError('');
    setMessage('');
    setBusy(subscription.id);
    try {
      await billingApi.changePlan(subscription.id, { planSlug: slug });
      setMessage('Plan change requested. It is priced into the next renewal.');
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Billing</h1>
          <p className="muted">Invoices, subscriptions and every ledger entry on your account.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}

      <section className="card">
        <h2>Invoices</h2>
        {invoices === null ? <p className="muted">Loading invoices…</p> : invoices.length === 0 ? (
          <p className="muted">No invoices yet. Anything you order will show up here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Issued</th>
                  <th scope="col">Due</th>
                  <th scope="col">Total</th>
                  <th scope="col">Balance</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const balance = invoiceBalance(invoice);
                  return (
                    <tr key={invoice.id}>
                      <td>{invoice.number}</td>
                      <td>{formatDate(invoice.issuedAt)}</td>
                      <td>
                        {formatDate(invoice.dueAt)}
                        {isOverdue(invoice) && <span className="pill pill-danger">Overdue</span>}
                      </td>
                      <td>{formatMoney(invoice.total, invoice.currency)}</td>
                      <td>{balance > 0 ? formatMoney(balance, invoice.currency) : '—'}</td>
                      <td><span className={statusClass(invoice.status)}>{humanizeStatus(invoice.status)}</span></td>
                      <td><Link to={`/billing/${encodeURIComponent(invoice.id)}`}>View</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Subscriptions</h2>
        {subscriptions === null ? <p className="muted">Loading subscriptions…</p>
          : subscriptions.length === 0 ? <p className="muted">No active subscriptions.</p> : (
            <ul className="list">
              {subscriptions.map((subscription) => (
                <li key={subscription.id} className="stack">
                  <div className="row">
                    <span className={statusClass(subscription.status)}>{humanizeStatus(subscription.status)}</span>
                    <span className="muted">{subscription.billingCycle} · renews {formatDate(subscription.renewsAt ?? subscription.currentPeriodEnd)}</span>
                  </div>
                  {(subscription.status === 'active' || subscription.status === 'past_due') && (
                    <div className="row row-wrap">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy === subscription.id}
                        onClick={() => cancelSubscription(subscription)}
                      >
                        Cancel at period end
                      </button>
                      <label className="sr-only" htmlFor={`plan-${subscription.id}`}>New plan</label>
                      <select
                        id={`plan-${subscription.id}`}
                        value={chosenPlan[subscription.id] ?? ''}
                        onChange={(event) => setChosenPlan((s) => ({ ...s, [subscription.id]: event.target.value }))}
                      >
                        <option value="">Choose a plan…</option>
                        {plans.map((plan) => (
                          <option key={`${plan.product}-${plan.slug}`} value={plan.slug}>
                            {plan.product} — {plan.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy === subscription.id || !chosenPlan[subscription.id]}
                        onClick={() => requestPlanChange(subscription)}
                      >
                        Request change
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="card">
        <h2>Ledger</h2>
        <p className="muted">Append-only: charges, payments and credits in the order they happened.</p>
        {ledger === null ? <p className="muted">Loading ledger…</p> : ledger.length === 0 ? (
          <p className="muted">No entries yet.</p>
        ) : (
          <ul className="list">
            {ledger.slice(0, 30).map((entry) => (
              <li key={entry.id}>
                <span>
                  <strong>{humanizeStatus(entry.entryType)}</strong>
                  <span className="muted"> {entry.description}</span>
                </span>
                <span>
                  {formatMoney(entry.amount, entry.currency)}
                  <span className="muted"> · {formatDate(entry.createdAt, { withTime: true })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
