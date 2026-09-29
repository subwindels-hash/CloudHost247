import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';
import HomePage from './pages/HomePage';
import AboutPage from './pages/AboutPage';
import HostingPage from './pages/HostingPage';
import HostingCpanelPage from './pages/HostingCpanelPage';
import HostingVpsPage from './pages/HostingVpsPage';
import DomainsMarketingPage from './pages/DomainsMarketingPage';
import ContactPage from './pages/ContactPage';
import FaqPage from './pages/FaqPage';
import LegalIndexPage from './pages/LegalIndexPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import AccountPage from './pages/AccountPage';
import ServicesPage from './pages/ServicesPage';
import DomainsPage from './pages/DomainsPage';
import DomainBrokeragePage from './pages/DomainBrokeragePage';
import BillingPage from './pages/BillingPage';
import InvoicesPage from './pages/InvoicesPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import SupportPage from './pages/SupportPage';
import SupportTicketPage from './pages/SupportTicketPage';
import AdminPage from './pages/AdminPage';
import AdminCustomerDetailPage from './pages/AdminCustomerDetailPage';
import AdminTicketsPage from './pages/AdminTicketsPage';
import AdminTicketDetailPage from './pages/AdminTicketDetailPage';
import { AdminInvoicesPage } from './pages/AdminInvoicesPage';
import { AdminInvoiceDetailPage } from './pages/AdminInvoiceDetailPage';
import { AdminLedgerPage } from './pages/AdminLedgerPage';
import MarketplacePage from './pages/MarketplacePage';
import AppDetailPage from './pages/AppDetailPage';
import MyAppsPage from './pages/MyAppsPage';
import AppInstancePage from './pages/AppInstancePage';
import DeploymentDetailPage from './pages/DeploymentDetailPage';
import DashboardServersPage from './pages/DashboardServersPage';
import DashboardDomainsPage from './pages/DashboardDomainsPage';
import AdminAppsPage from './pages/AdminAppsPage';
import AdminAppDetailPage from './pages/AdminAppDetailPage';
import AdminDeploymentsPage from './pages/AdminDeploymentsPage';
import AdminServersPage from './pages/AdminServersPage';
import AdminSettingsPage from './pages/AdminSettingsPage';
import AdminAuditPage from './pages/AdminAuditPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public marketing pages */}
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/hosting" element={<HostingPage />} />
        <Route path="/hosting/cpanel" element={<HostingCpanelPage />} />
        <Route path="/hosting/vps" element={<HostingVpsPage />} />
        <Route path="/domains" element={<DomainsMarketingPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/faq" element={<FaqPage />} />

        {/* Public, database-driven application marketplace. These routes intentionally sit
            outside RequireAuth so visitors can browse the catalog before signing in. */}
        <Route path="/apps" element={<MarketplacePage />} />
        <Route path="/apps/:slug" element={<AppDetailPage />} />

        <Route path="/legal" element={<LegalIndexPage />} />
        <Route path="/legal/privacy-policy" element={<PrivacyPolicyPage />} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Authenticated app shell — real protected routes (see components/RequireAuth.tsx). A
            signed-out visitor is redirected to /login instead of ever rendering these. */}
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/apps" element={<MyAppsPage />} />
          <Route path="/dashboard/apps/:id" element={<AppInstancePage />} />
          {/* Deep links mirror the dashboard information architecture from the platform
              specification. AppInstancePage owns the shared data/actions and selects the
              requested tab from the URL. */}
          <Route path="/dashboard/apps/:id/logs" element={<AppInstancePage />} />
          <Route path="/dashboard/apps/:id/backups" element={<AppInstancePage />} />
          <Route path="/dashboard/apps/:id/settings" element={<AppInstancePage />} />
          <Route path="/dashboard/apps/:id/domains" element={<AppInstancePage />} />
          <Route path="/dashboard/deployments/:id" element={<DeploymentDetailPage />} />
          <Route path="/dashboard/servers" element={<DashboardServersPage />} />
          <Route path="/dashboard/domains" element={<DashboardDomainsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/domains" element={<DomainsPage />} />
          <Route path="/account/domain-brokerage" element={<DomainBrokeragePage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/support/:id" element={<SupportTicketPage />} />

          {/* Staff-only (admin + super_admin) customer/ticket/billing management. RequireRole is a
              frontend convenience only — every route it guards independently re-verifies the
              caller's role server-side (see components/RequireRole.tsx). */}
          <Route element={<RequireRole roles={['admin', 'super_admin']} />}>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/customers/:id" element={<AdminCustomerDetailPage />} />
            <Route path="/admin/tickets" element={<AdminTicketsPage />} />
            <Route path="/admin/tickets/:id" element={<AdminTicketDetailPage />} />
            <Route path="/admin/invoices" element={<AdminInvoicesPage />} />
            <Route path="/admin/invoices/:id" element={<AdminInvoiceDetailPage />} />
            <Route path="/admin/ledger" element={<AdminLedgerPage />} />
            <Route path="/admin/apps" element={<AdminAppsPage />} />
            <Route path="/admin/applications/:id" element={<AdminAppDetailPage />} />
            <Route path="/admin/apps/:id" element={<AdminAppDetailPage />} />
            <Route path="/admin/deployments" element={<AdminDeploymentsPage />} />
            <Route path="/admin/deployments/:id" element={<AdminDeploymentsPage />} />
            <Route path="/admin/servers" element={<AdminServersPage />} />
            <Route path="/admin/servers/:id" element={<AdminServersPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route path="/admin/audit" element={<AdminAuditPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
