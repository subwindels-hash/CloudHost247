import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';

/**
 * Route components load on demand.
 *
 * Every page used to be imported at module scope, so the SPA shipped as ONE bundle: a visitor
 * landing on the marketing homepage downloaded the whole admin console, the revenue-guardian
 * suite and the Tools Center before the first paint — 993 kB of which ~800 kB was first-party
 * page code (the four remaining third-party packages total only ~191 kB). Each route is now its
 * own chunk, so a page only costs the browser that page.
 *
 * `Layout`, `RequireAuth` and `RequireRole` stay eager deliberately: they are the shell and the
 * auth gate, they render on every route, and lazy-loading them would add a round trip before the
 * shell could paint at all.
 *
 * The `Suspense` boundary for those chunks lives in `layout/Layout.tsx`, around the routed
 * outlet, so a loading chunk shows the shared CatalogLoadingBanner (role="status") in the page
 * body while the shell stays painted, instead of replacing the whole screen.
 */

const HomePage = lazy(() => import('./pages/HomePage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const HostingPage = lazy(() => import('./pages/HostingPage'));
const HostingCpanelPage = lazy(() => import('./pages/HostingCpanelPage'));
const HostingVpsPage = lazy(() => import('./pages/HostingVpsPage'));
const HostingDedicatedPage = lazy(() => import('./pages/HostingDedicatedPage'));
const HostingApplicationHostingPage = lazy(() => import('./pages/HostingApplicationHostingPage'));
const DomainsMarketingPage = lazy(() => import('./pages/DomainsMarketingPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const FaqPage = lazy(() => import('./pages/FaqPage'));
const LegalIndexPage = lazy(() => import('./pages/LegalIndexPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const ServicesPage = lazy(() => import('./pages/ServicesPage'));
const DomainsPage = lazy(() => import('./pages/DomainsPage'));
const DomainBrokeragePage = lazy(() => import('./pages/DomainBrokeragePage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'));
const InvoiceDetailPage = lazy(() => import('./pages/InvoiceDetailPage'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const SupportTicketPage = lazy(() => import('./pages/SupportTicketPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminCustomerDetailPage = lazy(() => import('./pages/AdminCustomerDetailPage'));
const AdminTicketsPage = lazy(() => import('./pages/AdminTicketsPage'));
const AdminTicketDetailPage = lazy(() => import('./pages/AdminTicketDetailPage'));
const AdminInvoicesPage = lazy(() => import('./pages/AdminInvoicesPage').then((m) => ({ default: m.AdminInvoicesPage })));
const AdminInvoiceDetailPage = lazy(() => import('./pages/AdminInvoiceDetailPage').then((m) => ({ default: m.AdminInvoiceDetailPage })));
const AdminLedgerPage = lazy(() => import('./pages/AdminLedgerPage').then((m) => ({ default: m.AdminLedgerPage })));
const MarketplacePage = lazy(() => import('./pages/MarketplacePage'));
const AppDetailPage = lazy(() => import('./pages/AppDetailPage'));
const MyAppsPage = lazy(() => import('./pages/MyAppsPage'));
const AppInstancePage = lazy(() => import('./pages/AppInstancePage'));
const DeploymentDetailPage = lazy(() => import('./pages/DeploymentDetailPage'));
const DashboardServersPage = lazy(() => import('./pages/DashboardServersPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const DashboardDomainsPage = lazy(() => import('./pages/DashboardDomainsPage'));
const AdminAppsPage = lazy(() => import('./pages/AdminAppsPage'));
const AdminAppDetailPage = lazy(() => import('./pages/AdminAppDetailPage'));
const AdminDeploymentsPage = lazy(() => import('./pages/AdminDeploymentsPage'));
const AdminServersPage = lazy(() => import('./pages/AdminServersPage'));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage'));
const AdminAuditPage = lazy(() => import('./pages/AdminAuditPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const NewServerPage = lazy(() => import('./pages/NewServerPage'));
const ServerDetailPage = lazy(() => import('./pages/ServerDetailPage'));
const ServerLogsPage = lazy(() => import('./pages/ServerLogsPage'));
const AdminOperatingSystemsPage = lazy(() => import('./pages/AdminOperatingSystemsPage'));
const AdminOsVersionsPage = lazy(() => import('./pages/AdminOsVersionsPage'));
const AdminOsImagesPage = lazy(() => import('./pages/AdminOsImagesPage'));
const AdminProvidersPage = lazy(() => import('./pages/AdminProvidersPage'));
const AdminAvailabilityPage = lazy(() => import('./pages/AdminAvailabilityPage'));
const AdminProvisioningPage = lazy(() => import('./pages/AdminProvisioningPage'));
const AdminInfrastructureLogsPage = lazy(() => import('./pages/AdminInfrastructureLogsPage'));
const ControlPanelsPage = lazy(() => import('./pages/ControlPanelsPage'));
const ControlPanelDetailPage = lazy(() => import('./pages/ControlPanelDetailPage'));
const AdminControlPanelsPage = lazy(() => import('./pages/AdminControlPanelsPage'));
const AdminLicensesPage = lazy(() => import('./pages/AdminLicensesPage'));
const AdminMonitoringPage = lazy(() => import('./pages/AdminMonitoringPage'));
const AdminAiSupportPage = lazy(() => import('./pages/AdminAiSupportPage'));
const AdminAiCommandPage = lazy(() => import('./pages/ai-os/AdminAiCommandPage'));
const AiAssistantPage = lazy(() => import('./pages/ai-os/AiAssistantPage'));
const RGDashboardPage = lazy(() => import('./pages/revenue-guardian/DashboardPage'));
const RecoveryQueuePage = lazy(() => import('./pages/revenue-guardian/RecoveryQueuePage'));
const RGCaseDetailPage = lazy(() => import('./pages/revenue-guardian/CaseDetailPage'));
const RGKanbanPage = lazy(() => import('./pages/revenue-guardian/KanbanPage'));
const RGFollowUpsPage = lazy(() => import('./pages/revenue-guardian/FollowUpsPage'));
const RGPromisesPage = lazy(() => import('./pages/revenue-guardian/PromisesPage'));
const RGAssignmentsPage = lazy(() => import('./pages/revenue-guardian/AssignmentsPage'));
const RGCustomerProfilePage = lazy(() => import('./pages/revenue-guardian/CustomerProfilePage'));
const RGReportsPage = lazy(() => import('./pages/revenue-guardian/ReportsPage'));
const RGOrdersPage = lazy(() => import('./pages/revenue-guardian/MonitorPages').then((m) => ({ default: m.OrdersPage })));
const RGRenewalsPage = lazy(() => import('./pages/revenue-guardian/MonitorPages').then((m) => ({ default: m.RenewalsPage })));
const RenewalRescuePage = lazy(() => import('./pages/revenue-guardian/MonitorPages').then((m) => ({ default: m.RenewalRescuePage })));
const ExpiringServicesPage = lazy(() => import('./pages/revenue-guardian/MonitorPages').then((m) => ({ default: m.ExpiringServicesPage })));
const PreSuspensionPage = lazy(() => import('./pages/revenue-guardian/MonitorPages').then((m) => ({ default: m.PreSuspensionPage })));
const PreTerminationPage = lazy(() => import('./pages/revenue-guardian/MonitorPages').then((m) => ({ default: m.PreTerminationPage })));
const RevenueAtRiskPage = lazy(() => import('./pages/revenue-guardian/InsightPages').then((m) => ({ default: m.RevenueAtRiskPage })));
const CustomerHealthPage = lazy(() => import('./pages/revenue-guardian/InsightPages').then((m) => ({ default: m.CustomerHealthPage })));
const HighValuePage = lazy(() => import('./pages/revenue-guardian/InsightPages').then((m) => ({ default: m.HighValuePage })));
const RiskAnalysisPage = lazy(() => import('./pages/revenue-guardian/InsightPages').then((m) => ({ default: m.RiskAnalysisPage })));
const ForecastPage = lazy(() => import('./pages/revenue-guardian/InsightPages').then((m) => ({ default: m.ForecastPage })));
const MyWorkPage = lazy(() => import('./pages/revenue-guardian/WorkPages').then((m) => ({ default: m.MyWorkPage })));
const StaffPerformancePage = lazy(() => import('./pages/revenue-guardian/WorkPages').then((m) => ({ default: m.StaffPerformancePage })));
const RGAutomationPage = lazy(() => import('./pages/revenue-guardian/AutomationPages').then((m) => ({ default: m.AutomationPage })));
const AutomationRunsPage = lazy(() => import('./pages/revenue-guardian/AutomationPages').then((m) => ({ default: m.AutomationRunsPage })));
const RGActivityLogPage = lazy(() => import('./pages/revenue-guardian/LogsPages').then((m) => ({ default: m.ActivityLogPage })));
const RGEmailLogsPage = lazy(() => import('./pages/revenue-guardian/LogsPages').then((m) => ({ default: m.EmailLogsPage })));
const RGSettingsPage = lazy(() => import('./pages/revenue-guardian/SettingsPages').then((m) => ({ default: m.RGSettingsPage })));
const RGModuleHealthPage = lazy(() => import('./pages/revenue-guardian/SettingsPages').then((m) => ({ default: m.ModuleHealthPage })));
const CloudflareServicesPage = lazy(() => import('./pages/cloudflare/CloudflareServicesPage'));
const CloudflareServicePage = lazy(() => import('./pages/cloudflare/CloudflareServicePage'));
const AdminCloudflarePage = lazy(() => import('./pages/AdminCloudflarePage'));
const AdminDomainServicesPage = lazy(() => import('./pages/AdminDomainServicesPage'));
const DomainSearchPage = lazy(() => import('./pages/domains/SearchPage'));
const DomainTransferPage = lazy(() => import('./pages/domains/TransferPage'));
const DomainExtensionsPage = lazy(() => import('./pages/domains/ExtensionsPage'));
const DomainAuctionsPage = lazy(() => import('./pages/domains/AuctionsPage'));
const DomainAuctionDetailPage = lazy(() => import('./pages/domains/AuctionDetailPage'));
const DomainAppraisalPage = lazy(() => import('./pages/domains/AppraisalPage'));
const DomainClubPage = lazy(() => import('./pages/domains/ClubPage'));
const DomainWhoisPage = lazy(() => import('./pages/domains/WhoisPage'));
const DomainBulkSearchPage = lazy(() => import('./pages/domains/BulkSearchPage'));
const DomainBrokerPage = lazy(() => import('./pages/domains/BrokerPage'));
const DnsManagementPage = lazy(() => import('./pages/DnsManagementPage'));
const ToolsCenterPage = lazy(() => import('./pages/ToolsCenterPage'));
const ToolPage = lazy(() => import('./pages/ToolPage'));
const ToolsHistoryPage = lazy(() => import('./pages/ToolsHistoryPage'));
const ToolsFavoritesPage = lazy(() => import('./pages/ToolsFavoritesPage'));
const ToolsReportsPage = lazy(() => import('./pages/ToolsReportsPage'));
const ToolsMonitorsPage = lazy(() => import('./pages/ToolsMonitorsPage'));
const DomainHealthPage = lazy(() => import('./pages/DomainHealthPage'));
const AdminToolsPage = lazy(() => import('./pages/AdminToolsPage'));
const SslManagementPage = lazy(() => import('./pages/SslManagementPage'));
const ToolsHubPage = lazy(() => import('./pages/tools/ToolsHubPage'));
const MrzToolPage = lazy(() => import('./pages/tools/MrzToolPage'));
const AdminMrzSettingsPage = lazy(() => import('./pages/AdminMrzSettingsPage'));
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
        {/* Domain Services hub pages. Browsing is public; actions that need an account
            (registering, transferring, bidding, appraising, bulk search, brokering) show an
            honest sign-in prompt, and the backend re-verifies auth + rate limits on every call. */}
        <Route path="/domains/search" element={<DomainSearchPage />} />
        <Route path="/domains/transfer" element={<DomainTransferPage />} />
        <Route path="/domains/extensions" element={<DomainExtensionsPage />} />
        <Route path="/domains/auctions" element={<DomainAuctionsPage />} />
        <Route path="/domains/auctions/:id" element={<DomainAuctionDetailPage />} />
        <Route path="/domains/appraisal" element={<DomainAppraisalPage />} />
        <Route path="/domains/club" element={<DomainClubPage />} />
        <Route path="/domains/whois" element={<DomainWhoisPage />} />
        <Route path="/domains/bulk-search" element={<DomainBulkSearchPage />} />
        <Route path="/domains/broker" element={<DomainBrokerPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/faq" element={<FaqPage />} />

        {/* Public, database-driven application marketplace. These routes intentionally sit
            outside RequireAuth so visitors can browse the catalog before signing in. */}
        <Route path="/apps" element={<MarketplacePage />} />
        <Route path="/apps/:slug" element={<AppDetailPage />} />

        {/* Tools Center: public discovery + individual tools. Tools that need an account say so
            on their card and are enforced again server-side, so a signed-out visitor never gets a
            broken page — only a clear "sign in to use this" message. */}
        <Route path="/tools" element={<ToolsCenterPage />} />
        <Route path="/tools/history" element={<ToolsHistoryPage />} />
        <Route path="/tools/favorites" element={<ToolsFavoritesPage />} />
        <Route path="/tools/reports" element={<ToolsReportsPage />} />
        <Route path="/tools/monitors" element={<ToolsMonitorsPage />} />
        {/* Tool pages use the catalogue's own nested paths (e.g. /tools/dns/propagation), so the
            whole /tools/* branch is handled by one page that resolves the path back to a tool. */}
        <Route path="/tools/*" element={<ToolPage />} />

        {/* Developer / Document Tools — ePassport MRZ Calculator & Parser. This is the Document
            Tools section of /tools, owned by its own module; React Router ranks these static paths
            above the Tools Center's /tools/* page route, so the MRZ pages keep working unchanged.
            The Tools Center hub links here rather than re-implementing them. */}
        <Route path="/tools/document" element={<ToolsHubPage />} />
        <Route path="/tools/document/mrz" element={<MrzToolPage defaultTab="calculator" />} />
        <Route path="/tools/document/mrz-parser" element={<MrzToolPage defaultTab="parser" />} />

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
          {/* Customer Cloud Assistant — server-side scoped to the caller's own account; safe for
              every signed-in role (customers see only their own data, staff see only theirs). */}
          <Route path="/account/assistant" element={<AiAssistantPage />} />
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
          <Route path="/domains/:domain/health" element={<DomainHealthPage />} />
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
            {/* AI Command Center: the full control plane (staff can view; gate-keeping actions
                like approvals/model-config are re-verified server-side per permission). */}
            <Route path="/admin/ai-command" element={<AdminAiCommandPage />} />
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
            <Route path="/admin/settings/tools/mrz" element={<AdminMrzSettingsPage />} />
            <Route path="/admin/tools/mrz" element={<AdminMrzSettingsPage />} />
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
          <Route path="/admin/tools" element={<AdminToolsPage />} />
            <Route path="/admin/ssl" element={<SslManagementPage />} />
            <Route path="/admin/audit-logs" element={<AdminAuditPage />} />
            <Route path="/admin/cloudflare" element={<AdminCloudflarePage />} />
            <Route path="/admin/cloudflare/:tab" element={<AdminCloudflarePage />} />
            <Route path="/admin/integrations/cloudflare" element={<AdminCloudflarePage />} />
            {/* Domain Services control room: providers + credentials + real Test Connection,
                extension catalogue + trending, auctions, transfers, Domain Club plans. */}
            <Route path="/admin/domain-services" element={<AdminDomainServicesPage />} />
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
