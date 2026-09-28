import type { ReactNode } from 'react';

/**
 * Shared loading/error banner for catalog-driven pages, so every page handles these states the
 * same, visible way instead of ever rendering a blank screen or silently swallowing a failure.
 */
export function CatalogLoadingBanner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="ch247-state-banner" role="status">
      {label}
    </div>
  );
}

export function CatalogErrorBanner({ message }: { message: string }) {
  return (
    <div className="ch247-state-banner ch247-state-banner--error" role="alert">
      <p>We couldn&apos;t load this right now.</p>
      <p className="ch247-page__hint">{message}</p>
    </div>
  );
}

export function CatalogEmptyBanner({ children }: { children: ReactNode }) {
  return <div className="ch247-state-banner">{children}</div>;
}
