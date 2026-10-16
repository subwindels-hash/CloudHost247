import React, { useState } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useAuth } from './lib/useAuth.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SupportPage from './pages/SupportPage.jsx';
import SecurityPage from './pages/SecurityPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import CartPage from './pages/CartPage.jsx';
import BillingPage from './pages/BillingPage.jsx';
import InvoiceDetailPage from './pages/InvoiceDetailPage.jsx';
import ServicesPage from './pages/ServicesPage.jsx';
import DnsPage from './pages/DnsPage.jsx';
import CloudflareServicesPage from './pages/CloudflareServicesPage.jsx';
import CloudflareServicePage from './pages/CloudflareServicePage.jsx';
import MarketplacePage from './pages/MarketplacePage.jsx';
import MyAppsPage from './pages/MyAppsPage.jsx';
import ServersPage from './pages/ServersPage.jsx';
import ServerDetailPage from './pages/ServerDetailPage.jsx';
import AdminLayout from './pages/AdminLayout.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import AdminCustomersPage from './pages/AdminCustomersPage.jsx';
import AdminCustomerDetailPage from './pages/AdminCustomerDetailPage.jsx';
import AdminTicketsPage from './pages/AdminTicketsPage.jsx';
import AdminTicketDetailPage from './pages/AdminTicketDetailPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminContentPage from './pages/AdminContentPage.jsx';
import AdminSiteSettingsPage from './pages/AdminSiteSettingsPage.jsx';
import AdminCatalogPage from './pages/AdminCatalogPage.jsx';
import AdminServersPage from './pages/AdminServersPage.jsx';
import AdminInfrastructurePage from './pages/AdminInfrastructurePage.jsx';
import AdminCloudflarePage from './pages/AdminCloudflarePage.jsx';
import AdminBillingPage from './pages/AdminBillingPage.jsx';
import AdminInvoiceDetailPage from './pages/AdminInvoiceDetailPage.jsx';
import AdminLedgerPage from './pages/AdminLedgerPage.jsx';
import AdminOrdersPage from './pages/AdminOrdersPage.jsx';
import AdminOrderDetailPage from './pages/AdminOrderDetailPage.jsx';
import AdminDomainServicesPage from './pages/AdminDomainServicesPage.jsx';
import AdminMarketplacePage from './pages/AdminMarketplacePage.jsx';
import AdminProvisioningPage from './pages/AdminProvisioningPage.jsx';
import AdminMonitoringPage from './pages/AdminMonitoringPage.jsx';
import AdminDeploymentsPage from './pages/AdminDeploymentsPage.jsx';
import AdminOsVersionsPage from './pages/AdminOsVersionsPage.jsx';
import AdminOsImagesPage from './pages/AdminOsImagesPage.jsx';
import AdminAvailabilityPage from './pages/AdminAvailabilityPage.jsx';
import AdminAiSupportPage from './pages/AdminAiSupportPage.jsx';
import AdminToolsPage from './pages/AdminToolsPage.jsx';
import AdminSecurityNumberPage from './pages/AdminSecurityNumberPage.jsx';
import { read as readSupportSession, finish as finishSupportSession } from './lib/support-session.js';

function Gate({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="page"><p className="muted">Loading your account…</p></div>;
  }

  if (!user) {
    return (
      <div className="page auth-notice">
        <div className="card">
          <h2>Sign in required</h2>
          <p className="muted">
            The dashboard is for signed-in customers. Sign in from the public site to continue.
          </p>
          <a className="btn btn-primary" href="/login.html?next=/app/account">Sign in</a>
        </div>
      </div>
    );
  }

  return children;
}

/**
 * The banner shown while a support session is active. Ending the session restores the admin's parked
 * credentials and, when the tab can reach the server, marks the session ended there too.
 */
function SupportSessionBanner() {
  const session = readSupportSession();
  const [ending, setEnding] = useState(false);

  if (!session) return null;

  return (
    <div className="support-banner" role="status">
      <span>
        Acting as <strong>{session.customer?.fullName ?? 'customer'}</strong>
        {session.customer?.email ? <span className="muted"> ({session.customer.email})</span> : null}
        {' '}— your own session is parked in this tab.
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={ending}
        onClick={async () => {
          setEnding(true);
          await finishSupportSession();
          window.location.assign('/app/admin');
        }}
      >
        {ending ? 'Ending…' : 'End support session'}
      </button>
    </div>
  );
}

export default function App() {
  const { user, signOut } = useAuth();

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <a className="app-brand" href="/"><span className="app-logo" aria-hidden="true">☁️</span> CloudHost247</a>
          <nav className="app-nav" aria-label="Dashboard">
            <NavLink to="/account" className={({ isActive }) => (isActive ? 'active' : '')}>Overview</NavLink>
            <NavLink to="/support" className={({ isActive }) => (isActive ? 'active' : '')}>Support</NavLink>
            <NavLink to="/services" className={({ isActive }) => (isActive ? 'active' : '')}>Services</NavLink>
            <NavLink to="/dns" className={({ isActive }) => (isActive ? 'active' : '')}>DNS</NavLink>
            <NavLink to="/cloudflare" className={({ isActive }) => (isActive ? 'active' : '')}>Cloudflare</NavLink>
            <NavLink to="/billing" className={({ isActive }) => (isActive ? 'active' : '')}>Billing</NavLink>
            <NavLink to="/catalog" className={({ isActive }) => (isActive ? 'active' : '')}>Products</NavLink>
            <NavLink to="/marketplace" className={({ isActive }) => (isActive ? 'active' : '')}>Marketplace</NavLink>
            <NavLink to="/apps" className={({ isActive }) => (isActive ? 'active' : '')}>My Apps</NavLink>
            <NavLink to="/servers" className={({ isActive }) => (isActive ? 'active' : '')}>Servers</NavLink>
            <NavLink to="/cart" className={({ isActive }) => (isActive ? 'active' : '')}>Cart</NavLink>
            <NavLink to="/security" className={({ isActive }) => (isActive ? 'active' : '')}>Security</NavLink>
            {user && user.role !== 'customer' && (
              <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>Admin</NavLink>
            )}
          </nav>
          <div className="app-user">
            {user && <span className="app-user-name">{user.fullName}</span>}
            <button type="button" className="btn btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      <SupportSessionBanner />

      <Routes>
        <Route path="/" element={<Navigate to="/account" replace />} />
        <Route path="/account" element={<Gate><DashboardPage /></Gate>} />
        <Route path="/support" element={<Gate><SupportPage /></Gate>} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/cart" element={<Gate><CartPage /></Gate>} />
        <Route path="/services" element={<Gate><ServicesPage /></Gate>} />
        <Route path="/dns" element={<Gate><DnsPage /></Gate>} />
        <Route path="/cloudflare" element={<Gate><CloudflareServicesPage /></Gate>} />
        <Route path="/cloudflare/:id" element={<Gate><CloudflareServicePage /></Gate>} />
        <Route path="/marketplace" element={<Gate><MarketplacePage /></Gate>} />
        <Route path="/apps" element={<Gate><MyAppsPage /></Gate>} />
        <Route path="/servers" element={<Gate><ServersPage /></Gate>} />
        <Route path="/servers/:id" element={<Gate><ServerDetailPage /></Gate>} />
        <Route path="/billing" element={<Gate><BillingPage /></Gate>} />
        <Route path="/billing/:id" element={<Gate><InvoiceDetailPage /></Gate>} />
        <Route path="/security" element={<Gate><SecurityPage /></Gate>} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="customers" element={<AdminCustomersPage />} />
          <Route path="customers/:id" element={<AdminCustomerDetailPage />} />
          <Route path="tickets" element={<AdminTicketsPage />} />
          <Route path="tickets/:id" element={<AdminTicketDetailPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="content" element={<AdminContentPage />} />
          <Route path="site-settings" element={<AdminSiteSettingsPage />} />
          <Route path="catalog" element={<AdminCatalogPage />} />
          <Route path="servers" element={<AdminServersPage />} />
          <Route path="infrastructure" element={<AdminInfrastructurePage />} />
          <Route path="cloudflare" element={<AdminCloudflarePage />} />
          <Route path="billing" element={<AdminBillingPage />} />
          <Route path="billing/ledger" element={<AdminLedgerPage />} />
          <Route path="billing/invoices/:id" element={<AdminInvoiceDetailPage />} />
          <Route path="orders" element={<AdminOrdersPage />} />
          <Route path="orders/:id" element={<AdminOrderDetailPage />} />
          <Route path="domain-services" element={<AdminDomainServicesPage />} />
          <Route path="marketplace" element={<AdminMarketplacePage />} />
          <Route path="provisioning" element={<AdminProvisioningPage />} />
          <Route path="monitoring" element={<AdminMonitoringPage />} />
          <Route path="deployments" element={<AdminDeploymentsPage />} />
          <Route path="os-versions" element={<AdminOsVersionsPage />} />
          <Route path="os-images" element={<AdminOsImagesPage />} />
          <Route path="availability" element={<AdminAvailabilityPage />} />
          <Route path="ai-support" element={<AdminAiSupportPage />} />
          <Route path="tools" element={<AdminToolsPage />} />
          <Route path="security-number" element={<AdminSecurityNumberPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/account" replace />} />
      </Routes>
    </div>
  );
}
