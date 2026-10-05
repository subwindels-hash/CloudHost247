import React from 'react';
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
            <NavLink to="/billing" className={({ isActive }) => (isActive ? 'active' : '')}>Billing</NavLink>
            <NavLink to="/catalog" className={({ isActive }) => (isActive ? 'active' : '')}>Products</NavLink>
            <NavLink to="/cart" className={({ isActive }) => (isActive ? 'active' : '')}>Cart</NavLink>
            <NavLink to="/security" className={({ isActive }) => (isActive ? 'active' : '')}>Security</NavLink>
          </nav>
          <div className="app-user">
            {user && <span className="app-user-name">{user.fullName}</span>}
            <button type="button" className="btn btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/account" replace />} />
        <Route path="/account" element={<Gate><DashboardPage /></Gate>} />
        <Route path="/support" element={<Gate><SupportPage /></Gate>} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/cart" element={<Gate><CartPage /></Gate>} />
        <Route path="/services" element={<Gate><ServicesPage /></Gate>} />
        <Route path="/billing" element={<Gate><BillingPage /></Gate>} />
        <Route path="/billing/:id" element={<Gate><InvoiceDetailPage /></Gate>} />
        <Route path="/security" element={<Gate><SecurityPage /></Gate>} />
        <Route path="*" element={<Navigate to="/account" replace />} />
      </Routes>
    </div>
  );
}
