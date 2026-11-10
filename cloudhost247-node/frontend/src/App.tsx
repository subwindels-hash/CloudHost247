import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout';
import { LEGAL_INDEX, MARKETING_ROUTES } from './navigation/registry.generated';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';

// ... [Existing imports from App.tsx - kept unchanged for brevity, but we'll add the new routes] ...

const HomePage = lazy(() => import('./pages/HomePage'));
// ... [Existing lazy imports from App.tsx - kept unchanged] ...
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

// NEW: Cloud Application Hosting Dashboard Section Components (Lazy Loaded)
const CloudHostingOverviewPage = lazy(() => import('./pages/cloud-hosting/OverviewPage'));
const CloudHostingApplicationsPage = lazy(() => import('./pages/cloud-hosting/ApplicationsPage'));
const CloudHostingDeployPage = lazy(() => import('./pages/cloud-hosting/DeployPage'));
const CloudHostingDatabasesPage = lazy(() => import('./pages/cloud-hosting/DatabasesPage'));
const CloudHostingDomainsPage = lazy(() => import('./pages/cloud-hosting/DomainsPage'));
const CloudHostingEnvironmentsPage = lazy(() => import('./pages/cloud-hosting/EnvironmentsPage'));
const CloudHostingHistoryPage = lazy(() => import('./pages/cloud-hosting/HistoryPage'));
const CloudHostingMonitoringPage = lazy(() => import('./pages/cloud-hosting/MonitoringPage'));
const CloudHostingBackupsPage = lazy(() => import('./pages/cloud-hosting/BackupsPage'));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public marketing pages */}
        <Route path="/" element={<HomePage />} />
        {/* ... [Existing marketing routes from App.tsx] ... */}
        <Route path="/sitemap" element={<SitemapPage />} />
        {/* ... [Existing routes] ... */}

        {/* CLOUD APPLICATION HOSTING DASHBOARD SECTION (NEW) */}
        <Route element={<RequireAuth />}>
          {/* Existing dashboard routes */}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/apps" element={<MyAppsPage />} />
          {/* ... [Existing dashboard routes] ... */}

          {/* NEW CLOUD APPLICATION HOSTING SECTION */}
          <Route path="/dashboard/cloud-hosting" element={<CloudHostingOverviewPage />} />
          <Route path="/dashboard/cloud-hosting/applications" element={<CloudHostingApplicationsPage />} />
          <Route path="/dashboard/cloud-hosting/deploy" element={<CloudHostingDeployPage />} />
          <Route path="/dashboard/cloud-hosting/databases" element={<CloudHostingDatabasesPage />} />
          <Route path="/dashboard/cloud-hosting/domains" element={<CloudHostingDomainsPage />} />
          <Route path="/dashboard/cloud-hosting/environments" element={<CloudHostingEnvironmentsPage />} />
          <Route path="/dashboard/cloud-hosting/history" element={<CloudHostingHistoryPage />} />
          <Route path="/dashboard/cloud-hosting/monitoring" element={<CloudHostingMonitoringPage />} />
          <Route path="/dashboard/cloud-hosting/backups" element={<CloudHostingBackupsPage />} />

          {/* Existing routes */}
          <Route path="/dashboard/apps/:id" element={<AppInstancePage />} />
          {/* ... [Rest of existing authenticated routes] ... */}
        </Route>

        {/* Staff-only routes */}
        <Route element={<RequireRole roles={['admin', 'super_admin']} />}>
          {/* ... [Existing admin routes] ... */}
        </Route>

        {/* Public site routes */}
        <Route path="/sites/:slug/*" element={<PublicSitePage />} />
        <Route path="/store/:slug" element={<StorefrontPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
