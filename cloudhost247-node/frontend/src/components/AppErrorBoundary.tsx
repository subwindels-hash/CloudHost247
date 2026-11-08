import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Keep a failed route or outdated lazy-loaded bundle from leaving a blank page. */
export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CloudHost247 could not display the page:', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main role="alert" style={{ maxWidth: 560, margin: '12vh auto', padding: 24, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6, color: '#171a18' }}>
          <h1>We couldn’t load this page.</h1>
          <p>The site may have been updated, or a connection may have been interrupted. Please refresh to try again.</p>
          {/*
            A real control, not an anchor with an empty target: an empty href navigates to the
            current URL and re-triggers the same failing render, and an empty link target is a dead
            link the integrity test rightly rejects. `location.reload()` also refetches the lazy
            chunk that failed to load, which is the actual remedy for a stale bundle.
          */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ color: '#315941', fontWeight: 700, background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}
          >
            Refresh page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
