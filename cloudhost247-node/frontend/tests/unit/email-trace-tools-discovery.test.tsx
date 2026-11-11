// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ToolsCenterPage from '../../src/pages/ToolsCenterPage';
import RequireAuth from '../../src/components/RequireAuth';

vi.mock('../../src/lib/tools-api', () => ({
  toolsApi: {
    catalog: vi.fn().mockResolvedValue({ tools: [], categories: [], discoveryCategories: [{ slug: 'email', label: 'Email' }, { slug: 'security', label: 'Security' }] }),
    dashboard: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('../../src/layout/useAuthState', () => ({ useAuthState: () => ({ token: null }) }));

afterEach(() => { cleanup(); document.getElementById('ch247-tools-root')?.remove(); });
function renderDirectory(path = '/tools') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/tools" element={<ToolsCenterPage />} />
    <Route path="/tools/category/:category" element={<ToolsCenterPage />} />
    <Route element={<RequireAuth />}><Route path="/account/email-trace" element={<p>Private trace</p>} /><Route path="/account/email-forensics" element={<p>Private forensics</p>} /></Route>
    <Route path="/login" element={<p>Sign in page</p>} />
  </Routes></MemoryRouter>);
}

describe('Email Trace discovery', () => {
  it('is searchable in all tools and opens the existing authenticated account route', async () => {
    renderDirectory();
    await screen.findByText('2 matching tools');
    expect(screen.getByRole('link', { name: 'Email Trace & Forensics Analyzer' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search tools'), { target: { value: 'email trace' } });
    expect(screen.getByText('2 matching tools')).toBeTruthy();
    expect(screen.getAllByText('Sign-in required')).toHaveLength(2);
    expect(screen.getByText('Mail-server setup required')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Open Email Trace' }));
    await screen.findByText('Sign in page');
    expect(screen.queryByText('Private trace')).toBeNull();
  });
  it('appears in Email but not unrelated categories or search results', async () => {
    const { unmount } = renderDirectory('/tools/category/email');
    await screen.findByText('2 matching tools');
    expect(screen.getByRole('link', { name: 'Email Trace' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Email Trace & Forensics Analyzer' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search tools'), { target: { value: 'forensics' } });
    expect(screen.getByText('1 matching tool')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Email Trace' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search tools'), { target: { value: 'no-such-tool' } });
    expect(screen.queryByRole('link', { name: 'Email Trace' })).toBeNull();
    expect(screen.getByText(/No tool matches/)).toBeTruthy();
    unmount();
    renderDirectory('/tools/category/security');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Email Trace' })).toBeNull());
  });
  it('requires authentication when opening the forensics analyzer', async () => {
    renderDirectory();
    await screen.findByText('2 matching tools');
    fireEvent.click(screen.getByRole('link', { name: /Open Email Trace & Forensics Analyzer/ }));
    await screen.findByText('Sign in page');
    expect(screen.queryByText('Private forensics')).toBeNull();
  });
  it('does not publish an application-only link in the embedded tools router', async () => {
    const root = document.createElement('div'); root.id = 'ch247-tools-root'; document.body.append(root);
    renderDirectory();
    await screen.findByText('0 matching tools');
    expect(screen.queryByRole('link', { name: 'Email Trace' })).toBeNull();
  });
});
