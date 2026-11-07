import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { LocaleProvider } from './i18n/LocaleProvider';
import { CurrencyProvider } from './currency/CurrencyProvider';
// Load order matters and is deliberate: the application stylesheets come first, then the shared
// design system, then the Hostinger-style layers last. Later layers win where rules overlap,
// which is what unifies the dashboard, the marketing site and the WHMCS theme on one palette.
import './styles.css';
import './ai-support.css';
import './infrastructure.css';
import './tools-center.css';
import './business-tools.css';
import './id-card.css';
import './platform.css';
import './published-site.css';
import '../../../shared/site/design-system.css';
// Hostinger-style public marketing layer. Loaded last so it can restyle the public pages
// without being undone by the older application stylesheets.
import './hostinger.css';
// Shared chrome (menu, mega menu, footer) on every route. Loaded after hostinger.css because a
// few of its rules intentionally override the marketing-layer treatment of the header/footer.
import './hostinger-chrome.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/,'') || '/'}>
      <LocaleProvider>
        <CurrencyProvider>
          <App />
        </CurrencyProvider>
      </LocaleProvider>
    </BrowserRouter>
  </React.StrictMode>
);
