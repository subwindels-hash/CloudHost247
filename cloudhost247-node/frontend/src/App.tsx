import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout';
import RequireAuth from './components/RequireAuth';
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
import BillingPage from './pages/BillingPage';
import InvoicesPage from './pages/InvoicesPage';
import SupportPage from './pages/SupportPage';
import AdminPage from './pages/AdminPage';
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
        <Route path="/support" element={<SupportPage />} />
        <Route path="/legal" element={<LegalIndexPage />} />
        <Route path="/legal/privacy-policy" element={<PrivacyPolicyPage />} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Authenticated app shell — real protected routes (see components/RequireAuth.tsx). A
            signed-out visitor is redirected to /login instead of ever rendering these. */}
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/domains" element={<DomainsPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
