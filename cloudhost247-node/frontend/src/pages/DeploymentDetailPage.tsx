import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  fetchDeployment,
  subscribeToDeployment,
  type DeploymentEvent,
  type DeploymentStep,
  type DeploymentSummary,
} from '../lib/marketplace-api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

/**
 * Live deployment console (spec §24): a "Deploying… ● Validating order ● Pulling image ✓"
 * stream fed by the SSE endpoint, with the step pipeline and full event log beneath. On
 * completion it shows the terminal state and links back to the installation.
 */
export default function DeploymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  usePageMeta('Deployment', 'Live deployment progress');
  const [deployment, setDeployment] = useState<DeploymentSummary | null>(null);
  const [steps, setSteps] = useState<DeploymentStep[]>([]);
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchDeployment(id)
      .then((result) => {
        if (cancelled) return;
        setDeployment(result.deployment);
        setSteps(result.steps);
        setEvents(result.events);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || !deployment) return;
    if (['succeeded', 'failed', 'cancelled', 'rolled_back'].includes(deployment.status)) return;
    const unsubscribe = subscribeToDeployment(id, {
      onEvents: (incoming) => setEvents((existing) => [...existing, ...incoming]),
      onState: (state) => {
        setSteps(state.steps);
        setDeployment((current) => (current ? { ...current, status: state.status } : current));
      },
      onDone: (outcome) => {
        setDeployment((current) => (current ? { ...current, status: outcome.status } : current));
        setNotice('');
      },
      onError: (message) => setNotice(message),
    });
    return unsubscribe;
  }, [id, deployment]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  if (error) return <CatalogErrorBanner message={error} />;
  if (!deployment) return <CatalogLoadingBanner label="Loading deployment…" />;

  const terminal = ['succeeded', 'failed', 'cancelled', 'rolled_back'].includes(deployment.status);
  const headline =
    deployment.status === 'succeeded'
      ? '✓ Deployment succeeded'
      : deployment.status === 'failed'
        ? `✗ Deployment failed${deployment.error_code ? ` (${deployment.error_code})` : ''}`
        : deployment.status === 'cancelled'
          ? 'Deployment cancelled'
          : 'Deploying…';

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>{headline}</h1>
        <p className="ch247-page__hint">
          {deployment.action} deployment · attempt {deployment.attempts} of {deployment.max_attempts} ·{' '}
          {new Date(deployment.created_at).toLocaleString()}
          {notice ? ` · ${notice}` : ''}
        </p>

        <ol className="ch247-pipeline">
          {steps.map((step) => (
            <li key={step.order} className={`is-${step.status}`}>
              <span className="ch247-pipeline__dot" aria-hidden="true" />
              {step.name}
              {step.status === 'running' ? ' (running…)' : ''}
              {step.error ? <small>{step.error}</small> : null}
            </li>
          ))}
        </ol>

        {deployment.error_message && (
          <p className="ch247-banner ch247-banner--error">{deployment.error_message}</p>
        )}

        {terminal && deployment.installation_id && (
          <Link className="ch247-btn ch247-btn--primary" to={`/dashboard/apps/${deployment.installation_id}`}>
            Back to application
          </Link>
        )}
      </div>

      <div className="ch247-card">
        <h2>Event log</h2>
        <div className="ch247-console" ref={logRef}>
          {events.length === 0 && <p className="ch247-page__hint">No events yet.</p>}
          {events.map((event) => (
            <div key={event.id} className={`ch247-console__line is-${event.level}`}>
              <span className="ch247-console__time">{new Date(event.created_at).toLocaleTimeString()}</span>
              {event.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
