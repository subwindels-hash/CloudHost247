import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/useAuth.jsx';
import { isNativePlatform, runMobileBoot } from '../../mobile/src/mobile-boot.js';
import './styles.css';

// Mobile shell bootstrap: no-op on the web, configures the API origin / splash / status bar /
// Android back button inside a Capacitor WebView. Runs before the first render.
const nativeShell = isNativePlatform();
runMobileBoot();

// The web app mounts under /app behind the platform's static host. A Capacitor WebView serves
// the bundle from local assets with no path prefix, and its local server does not guarantee
// HTML5-history fallback for deep links — hash routing is the deterministic choice there.
const Router = nativeShell ? HashRouter : BrowserRouter;
const routerProps = nativeShell ? {} : { basename: '/app' };

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Router {...routerProps}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Router>
  </React.StrictMode>
);

// Installable as a PWA from the dashboard as well as the public site.
// Not registered inside the native shell: Capacitor serves local assets and a service worker
// there would only cache stale app bundles behind the native release cycle.
if (!nativeShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}
