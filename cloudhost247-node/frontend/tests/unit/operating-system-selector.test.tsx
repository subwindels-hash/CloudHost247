// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperatingSystemSelector from '../../src/components/OperatingSystemSelector';
import type { AvailableOperatingSystem } from '../../src/lib/infrastructure-api';

const systems: AvailableOperatingSystem[] = [
  {
    id: 'os-debian',name: 'Debian',slug: 'debian',vendor: 'Debian Project',description: 'Stable Linux',logoUrl: '/database/debian.svg',
    versions: [{ id: 'debian-13',version: '13',displayName: 'Debian 13',releaseName: null,status:'ACTIVE',default: true,recommended: true,lts: false,architectures: ['x86_64','arm64'],availability: [] }],
  },
  {
    id: 'os-nixos',name: 'NixOS',slug: 'nixos',vendor: 'NixOS Foundation',description: null,logoUrl: null,
    versions: [{ id: 'nixos-25',version: '25.05',displayName: 'NixOS 25.05',releaseName: null,status:'ACTIVE',default: false,recommended: false,lts: false,architectures: ['x86_64'],availability: [] }],
  },
];

afterEach(cleanup);

describe('OperatingSystemSelector', () => {
  it('renders only backend-provided catalog values and passes architecture selection upward', async () => {
    const architectureChange=vi.fn();
    const {container}=render(<OperatingSystemSelector operatingSystems={systems} selectedOsId="os-debian" selectedVersionId="debian-13" selectedArchitecture="x86_64" onOsChange={()=>undefined} onVersionChange={()=>undefined} onArchitectureChange={architectureChange}/>);
    expect((await screen.findByRole('img', { name: 'Debian logo' })).tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('img, image')).toBeNull();
    expect(screen.getByText('NixOS')).toBeTruthy();
    expect(screen.queryByText('Ubuntu')).toBeNull();
    await userEvent.click(screen.getByLabelText('ARM64'));
    expect(architectureChange).toHaveBeenCalledWith('arm64');
  });

  it('shows the first eight options, reveals more on demand and keeps selected options visible', async () => {
    const many = Array.from({ length: 19 }, (_, index) => ({
      ...systems[0], id: `os-${index}`, slug: `os-test-${index}`, name: `System ${index + 1}`,
    }));
    const props = {
      operatingSystems: many, selectedOsId: 'os-0', selectedVersionId: 'debian-13',
      selectedArchitecture: 'x86_64', onOsChange: vi.fn(), onVersionChange: vi.fn(), onArchitectureChange: vi.fn(),
    };
    const { rerender } = render(<OperatingSystemSelector {...props} />);
    const osOptions = () => within(screen.getByRole('listbox', { name: 'Operating systems' })).getAllByRole('option');
    expect(osOptions()).toHaveLength(8);
    expect(screen.queryByText('System 9')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Show more operating systems/ }));
    expect(osOptions()).toHaveLength(16);
    await userEvent.click(screen.getByRole('button', { name: /Show more operating systems/ }));
    expect(osOptions()).toHaveLength(19);
    expect(screen.queryByRole('button', { name: /Show more operating systems/ })).toBeNull();

    await userEvent.type(screen.getByLabelText('Search operating systems'), 'System 19');
    expect(osOptions()).toHaveLength(1);
    await userEvent.clear(screen.getByLabelText('Search operating systems'));
    expect(osOptions()).toHaveLength(8);

    rerender(<OperatingSystemSelector {...props} selectedOsId="os-18" />);
    expect(osOptions()).toHaveLength(9);
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: /System 19/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('filters the catalog and uses code-rendered SVG even when the database has no logo URL', async () => {
    const { container } = render(<OperatingSystemSelector operatingSystems={systems} selectedOsId="os-nixos" selectedVersionId="nixos-25" selectedArchitecture="x86_64" onOsChange={()=>undefined} onVersionChange={()=>undefined} onArchitectureChange={()=>undefined}/>);
    expect((await screen.findByRole('img', { name: 'NixOS logo' })).tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('img, image')).toBeNull();
    await userEvent.type(screen.getByLabelText('Search operating systems'),'nix');
    expect(screen.getByText('NixOS')).toBeTruthy();
    expect(screen.queryByText('Debian')).toBeNull();
  });
});
