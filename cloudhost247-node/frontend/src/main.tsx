import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import './ai-support.css';
import './infrastructure.css';
import './tools-center.css';
import './platform.css';
import './published-site.css';

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
