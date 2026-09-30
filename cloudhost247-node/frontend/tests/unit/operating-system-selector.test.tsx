// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/database/debian.svg');
    expect(screen.getByText('NixOS')).toBeTruthy();
    expect(screen.queryByText('Ubuntu')).toBeNull();
    await userEvent.click(screen.getByLabelText('ARM64'));
    expect(architectureChange).toHaveBeenCalledWith('arm64');
  });

  it('filters the catalog and uses a neutral fallback when the database has no logo URL', async () => {
    render(<OperatingSystemSelector operatingSystems={systems} selectedOsId="os-nixos" selectedVersionId="nixos-25" selectedArchitecture="x86_64" onOsChange={()=>undefined} onVersionChange={()=>undefined} onArchitectureChange={()=>undefined}/>);
    expect(screen.getByText('NI')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Search operating systems'),'nix');
    expect(screen.getByText('NixOS')).toBeTruthy();
    expect(screen.queryByText('Debian')).toBeNull();
  });
});
