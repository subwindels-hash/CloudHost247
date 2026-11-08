// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppErrorBoundary from '../../src/components/AppErrorBoundary';

function BrokenPage(): never { throw new Error('Lazy page bundle failed'); }

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('application error boundary', () => {
  it('renders healthy children without a fallback', () => {
    render(<AppErrorBoundary><h1>Healthy page</h1></AppErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Healthy page' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a real reload action instead of a placeholder anchor', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const { container } = render(<AppErrorBoundary><BrokenPage /></AppErrorBoundary>);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'We couldn’t load this page.' })).toBeTruthy();
    const refresh = screen.getByRole('button', { name: 'Refresh page' });
    expect(refresh.getAttribute('type')).toBe('button');
    expect(container.querySelector('a')).toBeNull();
    fireEvent.click(refresh);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
