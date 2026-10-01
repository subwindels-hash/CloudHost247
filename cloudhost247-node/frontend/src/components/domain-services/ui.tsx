/**
 * Small shared Domain Services UI primitives: the honest Provider Not Configured state, status
 * chips, and formatters. Nothing here fabricates data — each component renders exactly what the
 * server returned.
 */
import type { ReactNode } from 'react';
import { AVAILABILITY_LABELS, type DomainAvailabilityStatus } from '../../lib/domain-services-api';

/** The single, honest unconfigured state required by the platform spec. */
export function ProviderNotConfigured({ service, admin }: { service: string; admin?: boolean }) {
  return (
    <div className="ch247-dsvc-provider-missing" role="status">
      <strong>Service Provider Not Configured</strong>
      <p style={{ margin: '0.4rem 0 0' }}>
        {service} needs a connected domain provider before it can show live results. Once a Super
        Admin configures and successfully tests the provider credentials
        {admin ? ' (Admin → Domain Services → Providers)' : ', this page will show real data immediately'}.
        No placeholder availability, pricing or results are shown in the meantime.
      </p>
    </div>
  );
}

export function AvailabilityChip({ status }: { status: DomainAvailabilityStatus }) {
  return <span className={`ch247-dsvc-status ch247-dsvc-status--${status}`}>{AVAILABILITY_LABELS[status] ?? status}</span>;
}

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const normalized = status.replace(/[^a-z0-9]+/g, '_').toLowerCase();
  return <span className={`ch247-dsvc-status ch247-dsvc-status--${normalized}`}>{label ?? status.replace(/_/g, ' ')}</span>;
}

export function formatPrice(amount: string | null, currency: string | null): string {
  if (amount === null || amount === undefined) return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return `${currency === 'USD' ? '$' : `${currency ?? ''} `}${value.toFixed(2)}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Countdown label for auction end times; falls back to the absolute time when not actionable. */
export function auctionEndsLabel(endsAt: string, now = Date.now()): string {
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return endsAt;
  const remaining = end - now;
  if (remaining <= 0) return 'Ended';
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
  if (hours >= 1) return `${hours}h ${minutes}m left`;
  return `${minutes}m ${seconds}s left`;
}

export function SectionCard({
  title,
  children,
  actions,
  style,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section className="ch247-card" style={style}>
      <div className="ch247-section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
