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
          {/* Refresh is an action, not navigation: an empty href is a placeholder-anchor smell,
              and a same-hash link would not reliably reload the failed bundle. */}
          <button type="button" onClick={() => window.location.reload()}
            style={{ padding: 0, border: 0, background: 'none', color: '#315941', font: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
            Refresh page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
