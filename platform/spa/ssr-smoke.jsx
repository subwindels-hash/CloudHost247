/**
 * Page smoke check: render every page module once on the server.
 *
 * This is not a UI test — effects never run under server rendering, so each page renders its
 * loading state. What it does catch is the class of breakage a build alone misses: a bad import, a
 * hook used outside a component, a module that touches `document` at load time, or a page that
 * throws while computing its initial render. Run with `npm run smoke` in `spa/`.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './src/pages/DashboardPage.jsx';
import CatalogPage from './src/pages/CatalogPage.jsx';
import CartPage from './src/pages/CartPage.jsx';
import BillingPage from './src/pages/BillingPage.jsx';
import InvoiceDetailPage from './src/pages/InvoiceDetailPage.jsx';
import ServicesPage from './src/pages/ServicesPage.jsx';
import SecurityPage from './src/pages/SecurityPage.jsx';
import SupportPage from './src/pages/SupportPage.jsx';
import AdminLayout from './src/pages/AdminLayout.jsx';
import AdminDashboardPage from './src/pages/AdminDashboardPage.jsx';
import AdminCustomersPage from './src/pages/AdminCustomersPage.jsx';
import AdminCustomerDetailPage from './src/pages/AdminCustomerDetailPage.jsx';
import AdminTicketsPage from './src/pages/AdminTicketsPage.jsx';
import AdminTicketDetailPage from './src/pages/AdminTicketDetailPage.jsx';
import AdminCatalogPage from './src/pages/AdminCatalogPage.jsx';
import AdminServersPage from './src/pages/AdminServersPage.jsx';
import AdminInfrastructurePage from './src/pages/AdminInfrastructurePage.jsx';
import AdminCloudflarePage from './src/pages/AdminCloudflarePage.jsx';
import AdminUsersPage from './src/pages/AdminUsersPage.jsx';

const pages = {
  DashboardPage, CatalogPage, CartPage, BillingPage, InvoiceDetailPage, ServicesPage, SecurityPage, SupportPage,
  AdminLayout, AdminDashboardPage, AdminCustomersPage, AdminCustomerDetailPage,
  AdminTicketsPage, AdminTicketDetailPage, AdminUsersPage, AdminCatalogPage, AdminServersPage, AdminInfrastructurePage, AdminCloudflarePage,
};
const results = {};
for (const [name, Page] of Object.entries(pages)) {
  try {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/billing/00000000-0000-7000-8000-000000000000']}>
        <Page />
      </MemoryRouter>,
    );
    results[name] = { ok: true, length: html.length, head: html.slice(0, 60) };
  } catch (err) {
    results[name] = { ok: false, error: err.message };
  }
}
console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
