import '../../../../shared/site/visitor-intelligence.js';

export interface VisitorIntelligenceRuntime {
  start(options?: { apiBase?: string; autoPageView?: boolean }): VisitorIntelligenceRuntime;
  pageView(path: string): boolean;
  stop(): void;
  isEnabled(): boolean;
}

declare global {
  interface Window { CloudHost247VisitorIntelligence: VisitorIntelligenceRuntime }
}

let started = false;

/**
 * Starts the shared first-party tracker after the shared consent runtime is available. The browser
 * tracker independently re-checks analytics consent and the operator's enabled setting before it
 * creates identifiers or sends any pageview/heartbeat.
 */
export function startVisitorIntelligence() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  window.CloudHost247VisitorIntelligence.start({
    apiBase: `${base}/api/v1/visitor-intelligence`,
    autoPageView: false,
  });
}

export function trackVisitorPageView(path: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.CloudHost247VisitorIntelligence.pageView(path);
}
