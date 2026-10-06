import { useCallback, useState, type ReactNode } from 'react';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../CatalogStateBanner';
import { ApiRequestError } from '../../lib/api';
import type { ApiResourceState } from '../../lib/useApiResource';

/**
 * Small shared pieces for the platform-services pages.
 *
 * `StateBanner` exists so every page renders the same three real states (loading / error / content)
 * and — importantly — so a 404 can be distinguished from a failure. A 404 on a catalogue endpoint
 * means "nothing is published here yet", which is honest information the page shows explicitly
 * instead of pretending the feature is broken or inventing a default.
 */
export function StateBanner<T>({
  state,
  empty,
  children,
}: {
  state: ApiResourceState<T>;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') return <CatalogLoadingBanner />;
  if (state.status === 'error') {
    if (state.httpStatus === 404) {
      return (
        <div className="ch247-state-banner">
          {empty ?? 'Nothing has been published here yet. An administrator can add it from the admin console.'}
        </div>
      );
    }
    return <CatalogErrorBanner message={state.message} />;
  }
  return <>{children(state.data)}</>;
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={`ch247-pill${tone === 'neutral' ? '' : ` ch247-pill--${tone}`}`}>{children}</span>;
}

/** Status → tone mapping shared by every page so the same state never shows two different colours. */
export function statusTone(status: string): 'neutral' | 'ok' | 'warn' | 'bad' {
  const value = status.toLowerCase();
  if (['active', 'published', 'completed', 'paid', 'delivered', 'connected', 'succeeded', 'approved'].includes(value)) return 'ok';
  if (['failed', 'cancelled', 'rejected', 'suspended', 'error', 'unavailable'].includes(value)) return 'bad';
  if (['pending', 'requested', 'processing', 'quoted', 'planning', 'in_progress', 'collecting', 'manual', 'not_configured', 'draft'].includes(value)) return 'warn';
  return 'neutral';
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="ch247-state-banner">{children}</div>;
}

/**
 * Runs one mutation with a single busy flag and a real error/success message. Pages use this instead
 * of ad-hoc try/catch so a failed action is always visible to the user, and a 401 is never silently
 * swallowed (apiFetch has already cleared the session in that case).
 */
export function useAction(onDone?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const run = useCallback(
    async (action: () => Promise<string | void>) => {
      setBusy(true);
      setError('');
      setMessage('');
      try {
        const result = await action();
        if (typeof result === 'string') setMessage(result);
        onDone?.();
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'CONFIGURATION_REQUIRED') {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : 'That action could not be completed.');
        }
      } finally {
        setBusy(false);
      }
    },
    [onDone]
  );

  return { run, busy, error, message, setMessage, setError, clear: () => { setError(''); setMessage(''); } };
}

export function Feedback({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <div className={`ch247-banner${error ? ' ch247-banner--error' : ' ch247-banner--info'}`} role={error ? 'alert' : 'status'}>
      {error || message}
    </div>
  );
}

/** Renders a plan price, or an honest "not priced yet" state — never a made-up number. */
export function PlanPrice({ amount, currency, period }: { amount: string | null; currency: string; period?: string | null }) {
  if (!amount) {
    return <span className="ch247-plan-card__price-unpublished">Price not published yet</span>;
  }
  const value = Number(amount);
  const formatted = Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(value)
    : `${currency} ${amount}`;
  return (
    <span className="ch247-plan-card__price">
      {formatted}
      {period ? <small> / {period.replace('_', ' ')}</small> : null}
    </span>
  );
}
