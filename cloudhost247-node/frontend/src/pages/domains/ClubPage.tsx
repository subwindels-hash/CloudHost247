import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import type { ClubPlanDto, MembershipDto } from '../../lib/domain-services-api';
import { formatDateTime, formatPrice } from '../../components/domain-services/ui';

/**
 * Discount Domain Club: plans, member pricing and membership management. Plan prices and
 * discounts are Super Admin configured; the savings figures here are computed server-side from
 * those plans, never in the browser.
 */
export default function ClubPage() {
  usePageMeta('Discount Domain Club', 'Member pricing on domain registrations.');
  const token = getToken();

  const [plans, setPlans] = useState<ClubPlanDto[] | null>(null);
  const [membership, setMembership] = useState<MembershipDto | null>(null);
  const [preview, setPreview] = useState<{ standardPrice: string; memberPrice: string | null; savings: string | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    apiFetch<{ plans: ClubPlanDto[] }>('/api/v1/domain-services/club/plans')
      .then((response) => setPlans(response.plans))
      .catch((err: Error) => setError(err.message));
    if (token) {
      apiFetch<{ membership: MembershipDto | null }>('/api/v1/domain-services/club/membership')
        .then((response) => setMembership(response.membership))
        .catch(() => undefined);
      apiFetch<{ standardPrice: string; memberPrice: string | null; savings: string | null }>(
        '/api/v1/domain-services/club/pricing-preview?standardPrice=20.00'
      )
        .then(setPreview)
        .catch(() => undefined);
    }
  }, [token]);

  useEffect(() => load(), [load]);

  async function subscribe(planId: string) {
    setBusy(planId);
    setMessage('');
    try {
      const response = await apiFetch<{ membershipId: string; invoiceId: string; invoiceNumber: string }>(
        `/api/v1/domain-services/club/plans/${planId}/subscribe`,
        { method: 'POST' }
      );
      setMessage(`Membership created. Pay invoice ${response.invoiceNumber} to activate member pricing.`);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The subscription could not be started.');
    } finally {
      setBusy('');
    }
  }

  async function cancel() {
    if (!window.confirm('Cancel your Domain Club membership? Member pricing stops at the end of the paid term.')) return;
    setBusy('cancel');
    try {
      await apiFetch('/api/v1/domain-services/club/membership', { method: 'DELETE' });
      setMessage('Membership cancelled. Member pricing remains active until the paid term ends.');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The membership could not be cancelled.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Discount Domain Club</h1>
          <p>One membership, member pricing on eligible domain registrations.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}
          {message && <p className="ch247-banner ch247-banner--info" role="status">{message}</p>}

          {preview?.memberPrice && (
            <section className="ch247-card">
              <h2>What membership saves</h2>
              <dl className="ch247-dsvc-facts">
                <div className="ch247-dsvc-fact"><dt>Standard price</dt><dd>${preview.standardPrice}</dd></div>
                <div className="ch247-dsvc-fact"><dt>Member price</dt><dd><strong>${preview.memberPrice}</strong></dd></div>
                <div className="ch247-dsvc-fact"><dt>You save</dt><dd>${preview.savings}</dd></div>
              </dl>
              <p className="ch247-page__hint">
                Example based on a $20.00 registration. Discounts are applied automatically at checkout from your
                active membership — the price you see is computed server-side.
              </p>
            </section>
          )}

          {membership && (
            <section className="ch247-card" style={{ marginTop: '1.25rem' }}>
              <h2>Your membership</h2>
              <dl className="ch247-dsvc-kv">
                <dt>Plan</dt><dd>{membership.planName}</dd>
                <dt>Status</dt><dd>{membership.status.replace(/_/g, ' ')}</dd>
                <dt>Member since</dt><dd>{formatDateTime(membership.startsAt ?? membership.createdAt)}</dd>
                <dt>Renews / expires</dt><dd>{formatDateTime(membership.renewsAt)}</dd>
              </dl>
              {membership.status === 'active' && (
                <p style={{ marginTop: '0.75rem' }}>
                  <button className="ch247-button ch247-button--danger" type="button" onClick={() => void cancel()} disabled={busy === 'cancel'}>
                    Cancel membership
                  </button>
                </p>
              )}
            </section>
          )}

          <h2 style={{ marginTop: '2rem' }}>Plans</h2>
          {plans === null && <p className="ch247-page__hint">Loading plans…</p>}
          {plans !== null && plans.length === 0 && (
            <p className="ch247-page__hint">
              No Domain Club plans have been published yet. Plans, pricing and discounts are configured by CloudHost247 —
              none are shown until they are real.
            </p>
          )}
          <div className="ch247-dsvc-grid">
            {(plans ?? []).map((plan) => (
              <article className="ch247-dsvc-card" key={plan.id}>
                <div className="ch247-dsvc-card__icon ch247-dsvc-card__icon--accent" aria-hidden="true">🏷</div>
                <h3 className="ch247-dsvc-card__title">{plan.name}</h3>
                <p className="ch247-dsvc-card__text">
                  {formatPrice(plan.priceAmount, plan.currency)} / {plan.billingPeriod === 'monthly' ? 'month' : 'year'}
                  <br />
                  {plan.discountType === 'percentage'
                    ? `${Number(plan.discountValue).toFixed(0)}% off eligible registrations`
                    : `$${plan.discountValue} off eligible registrations`}
                </p>
                {plan.description && <p className="ch247-dsvc-card__text">{plan.description}</p>}
                <p className="ch247-dsvc-card__text">
                  {plan.eligibleExtensions.length === 0
                    ? 'Applies to all supported extensions'
                    : `Eligible extensions: ${plan.eligibleExtensions.join(', ')}`}
                </p>
                {token ? (
                  <button
                    className="ch247-button"
                    type="button"
                    disabled={busy === plan.id || membership?.status === 'active'}
                    onClick={() => void subscribe(plan.id)}
                  >
                    {membership?.status === 'active' ? 'Membership active' : busy === plan.id ? 'Starting…' : 'Join the club'}
                  </button>
                ) : (
                  <Link className="ch247-dsvc-card__link" to="/login">Sign in to join</Link>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
