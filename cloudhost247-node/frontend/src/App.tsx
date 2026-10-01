import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';
import HomePage from './pages/HomePage';
import AboutPage from './pages/AboutPage';
import HostingPage from './pages/HostingPage';
import HostingCpanelPage from './pages/HostingCpanelPage';
import HostingVpsPage from './pages/HostingVpsPage';
import HostingDedicatedPage from './pages/HostingDedicatedPage';
import HostingApplicationHostingPage from './pages/HostingApplicationHostingPage';
import DomainsMarketingPage from './pages/DomainsMarketingPage';
import ContactPage from './pages/ContactPage';
import FaqPage from './pages/FaqPage';
import LegalIndexPage from './pages/LegalIndexPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
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
import NotificationsPage from './pages/NotificationsPage';
import DashboardDomainsPage from './pages/DashboardDomainsPage';
import AdminAppsPage from './pages/AdminAppsPage';
import AdminAppDetailPage from './pages/AdminAppDetailPage';
import AdminDeploymentsPage from './pages/AdminDeploymentsPage';
import AdminServersPage from './pages/AdminServersPage';
import AdminSettingsPage from './pages/AdminSettingsPage';
import AdminAuditPage from './pages/AdminAuditPage';
import NotFoundPage from './pages/NotFoundPage';
import NewServerPage from './pages/NewServerPage';
import ServerDetailPage from './pages/ServerDetailPage';
import ServerLogsPage from './pages/ServerLogsPage';
import AdminOperatingSystemsPage from './pages/AdminOperatingSystemsPage';
import AdminOsVersionsPage from './pages/AdminOsVersionsPage';
import AdminOsImagesPage from './pages/AdminOsImagesPage';
import AdminProvidersPage from './pages/AdminProvidersPage';
import AdminAvailabilityPage from './pages/AdminAvailabilityPage';
import AdminProvisioningPage from './pages/AdminProvisioningPage';
import AdminInfrastructureLogsPage from './pages/AdminInfrastructureLogsPage';
import ControlPanelsPage from './pages/ControlPanelsPage';
import ControlPanelDetailPage from './pages/ControlPanelDetailPage';
import AdminControlPanelsPage from './pages/AdminControlPanelsPage';
import AdminLicensesPage from './pages/AdminLicensesPage';
import AdminMonitoringPage from './pages/AdminMonitoringPage';
import AdminAiSupportPage from './pages/AdminAiSupportPage';
import RGDashboardPage from './pages/revenue-guardian/DashboardPage';
import RecoveryQueuePage from './pages/revenue-guardian/RecoveryQueuePage';
import RGCaseDetailPage from './pages/revenue-guardian/CaseDetailPage';
import RGKanbanPage from './pages/revenue-guardian/KanbanPage';
import RGFollowUpsPage from './pages/revenue-guardian/FollowUpsPage';
import RGPromisesPage from './pages/revenue-guardian/PromisesPage';
import RGAssignmentsPage from './pages/revenue-guardian/AssignmentsPage';
import RGCustomerProfilePage from './pages/revenue-guardian/CustomerProfilePage';
import RGReportsPage from './pages/revenue-guardian/ReportsPage';
import {
  OrdersPage as RGOrdersPage,
  RenewalsPage as RGRenewalsPage,
  RenewalRescuePage,
  ExpiringServicesPage,
  PreSuspensionPage,
  PreTerminationPage,
} from './pages/revenue-guardian/MonitorPages';
import {
  RevenueAtRiskPage,
  CustomerHealthPage,
  HighValuePage,
  RiskAnalysisPage,
  ForecastPage,
} from './pages/revenue-guardian/InsightPages';
import { MyWorkPage, StaffPerformancePage } from './pages/revenue-guardian/WorkPages';
import { AutomationPage as RGAutomationPage, AutomationRunsPage } from './pages/revenue-guardian/AutomationPages';
import { ActivityLogPage as RGActivityLogPage, EmailLogsPage as RGEmailLogsPage } from './pages/revenue-guardian/LogsPages';
import { RGSettingsPage, ModuleHealthPage as RGModuleHealthPage } from './pages/revenue-guardian/SettingsPages';
import CloudflareServicesPage from './pages/cloudflare/CloudflareServicesPage';
import CloudflareServicePage from './pages/cloudflare/CloudflareServicePage';
import AdminCloudflarePage from './pages/AdminCloudflarePage';
import DnsManagementPage from './pages/DnsManagementPage';
import SslManagementPage from './pages/SslManagementPage';

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
        <Route path="/hosting/dedicated" element={<HostingDedicatedPage />} />
        <Route path="/hosting/application-hosting" element={<HostingApplicationHostingPage />} />
        <Route path="/hosting/control-panels" element={<ControlPanelsPage />} />
        <Route path="/hosting/control-panels/:slug" element={<ControlPanelDetailPage />} />
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
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

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
          <Route path="/dashboard/notifications" element={<NotificationsPage />} />
          <Route path="/dashboard/servers/:id" element={<ServerDetailPage />} />
          <Route path="/dashboard/servers/:id/logs" element={<ServerLogsPage />} />
          <Route path="/servers/new" element={<NewServerPage />} />
          <Route path="/dashboard/domains" element={<DashboardDomainsPage />} />
          <Route path="/dashboard/dns" element={<DnsManagementPage />} />
          <Route path="/dashboard/ssl" element={<SslManagementPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/domains" element={<DomainsPage />} />
          <Route path="/account/dns" element={<DnsManagementPage />} />
          <Route path="/account/ssl" element={<SslManagementPage />} />
          <Route path="/account/domain-brokerage" element={<DomainBrokeragePage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/services/cloudflare" element={<CloudflareServicesPage />} />
          <Route path="/services/cloudflare/:id" element={<CloudflareServicePage />} />
          <Route path="/services/cloudflare/:id/:tab" element={<CloudflareServicePage />} />
          <Route path="/account/services" element={<ServicesPage />} />
          <Route path="/account/services/:id" element={<ServerDetailPage />} />
          <Route path="/account/services/:id/overview" element={<ServerDetailPage />} />
          <Route path="/account/services/:id/monitoring" element={<ServerDetailPage />} />
          <Route path="/account/services/:id/dns" element={<ServerDetailPage />} />
          <Route path="/account/services/:id/ssl" element={<ServerDetailPage />} />
          <Route path="/account/services/:id/backups" element={<ServerDetailPage />} />
          <Route path="/account/services/:id/firewall" element={<ServerDetailPage />} />
          <Route path="/account/services/:id/billing" element={<ServerDetailPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/support/:id" element={<SupportTicketPage />} />

          {/* The AI support desk is available to staff, admin, and super_admin operators. The
              backend independently re-verifies the role on every request. */}
          <Route element={<RequireRole roles={['staff', 'admin', 'super_admin']} />}>
            <Route path="/admin/ai-support" element={<AdminAiSupportPage />} />
          </Route>

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
            <Route path="/admin/infrastructure" element={<AdminProvidersPage />} />
            <Route path="/admin/infrastructure/operating-systems" element={<AdminOperatingSystemsPage />} />
            <Route path="/admin/infrastructure/operating-systems/:slug/versions" element={<AdminOsVersionsPage />} />
            <Route path="/admin/infrastructure/images" element={<AdminOsImagesPage />} />
            <Route path="/admin/infrastructure/providers" element={<AdminProvidersPage />} />
            <Route path="/admin/infrastructure/availability" element={<AdminAvailabilityPage />} />
            <Route path="/admin/infrastructure/provisioning" element={<AdminProvisioningPage />} />
            <Route path="/admin/infrastructure/provisioning/:id" element={<AdminProvisioningPage />} />
            <Route path="/admin/infrastructure/logs" element={<AdminInfrastructureLogsPage />} />
            <Route path="/admin/control-panels" element={<AdminControlPanelsPage />} />
            <Route path="/admin/control-panels/:id" element={<AdminControlPanelsPage />} />
            <Route path="/admin/infrastructure/control-panels" element={<AdminControlPanelsPage />} />
            <Route path="/admin/licenses" element={<AdminLicensesPage />} />
            <Route path="/admin/monitoring" element={<AdminMonitoringPage />} />
            <Route path="/admin/dns" element={<DnsManagementPage />} />
            <Route path="/admin/ssl" element={<SslManagementPage />} />
            <Route path="/admin/audit-logs" element={<AdminAuditPage />} />
            <Route path="/admin/cloudflare" element={<AdminCloudflarePage />} />
            <Route path="/admin/cloudflare/:tab" element={<AdminCloudflarePage />} />
            <Route path="/admin/integrations/cloudflare" element={<AdminCloudflarePage />} />
          </Route>

          {/* Revenue Guardian — staff accounts also participate (with a server-enforced,
              portfolio-scoped permission subset; see src/revenue-guardian/permissions.ts). */}
          <Route element={<RequireRole roles={['staff', 'admin', 'super_admin']} />}>
            <Route path="/admin/revenue-guardian" element={<RGDashboardPage />} />
            <Route path="/admin/revenue-guardian/my-work" element={<MyWorkPage />} />
            <Route path="/admin/revenue-guardian/revenue-at-risk" element={<RevenueAtRiskPage />} />
            <Route path="/admin/revenue-guardian/customer-health" element={<CustomerHealthPage />} />
            <Route path="/admin/revenue-guardian/high-value" element={<HighValuePage />} />
            <Route path="/admin/revenue-guardian/recovery" element={<RecoveryQueuePage />} />
            <Route path="/admin/revenue-guardian/recovery/:id" element={<RGCaseDetailPage />} />
            <Route path="/admin/revenue-guardian/kanban" element={<RGKanbanPage />} />
            <Route path="/admin/revenue-guardian/follow-ups" element={<RGFollowUpsPage />} />
            <Route path="/admin/revenue-guardian/promises" element={<RGPromisesPage />} />
            <Route path="/admin/revenue-guardian/assignments" element={<RGAssignmentsPage />} />
            <Route path="/admin/revenue-guardian/orders" element={<RGOrdersPage />} />
            <Route path="/admin/revenue-guardian/renewals" element={<RGRenewalsPage />} />
            <Route path="/admin/revenue-guardian/renewal-rescue" element={<RenewalRescuePage />} />
            <Route path="/admin/revenue-guardian/expiring-services" element={<ExpiringServicesPage />} />
            <Route path="/admin/revenue-guardian/pre-suspension" element={<PreSuspensionPage />} />
            <Route path="/admin/revenue-guardian/pre-termination" element={<PreTerminationPage />} />
            <Route path="/admin/revenue-guardian/customers/:id" element={<RGCustomerProfilePage />} />
            <Route path="/admin/revenue-guardian/risk-analysis" element={<RiskAnalysisPage />} />
            <Route path="/admin/revenue-guardian/forecast" element={<ForecastPage />} />
            <Route path="/admin/revenue-guardian/reports" element={<RGReportsPage />} />
            <Route path="/admin/revenue-guardian/staff-performance" element={<StaffPerformancePage />} />
            <Route path="/admin/revenue-guardian/automation" element={<RGAutomationPage />} />
            <Route path="/admin/revenue-guardian/automation/runs" element={<AutomationRunsPage />} />
            <Route path="/admin/revenue-guardian/activity" element={<RGActivityLogPage />} />
            <Route path="/admin/revenue-guardian/email-logs" element={<RGEmailLogsPage />} />
            <Route path="/admin/revenue-guardian/module-health" element={<RGModuleHealthPage />} />
            <Route path="/admin/revenue-guardian/settings" element={<RGSettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
