import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
// Load order matters and is deliberate: the application stylesheets come first and the shared
// design system last, so the design system's tokens and component rules win where the two
// overlap. That is what unifies the dashboard, the marketing site and the WHMCS theme on one
// palette instead of three.
import './styles.css';
import './ai-support.css';
import './infrastructure.css';
import './tools-center.css';
import './business-tools.css';
import './platform.css';
import './published-site.css';
import '../../../shared/site/design-system.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/,'') || '/'}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
