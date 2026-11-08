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
          <a href="" style={{ color: '#315941', fontWeight: 700 }}>Refresh page</a>
        </main>
      );
    }
    return this.props.children;
  }
}
