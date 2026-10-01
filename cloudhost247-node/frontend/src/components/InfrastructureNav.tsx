import { Link } from 'react-router-dom';

export type InfrastructureNavKey =
  | 'servers'
  | 'providers'
  | 'control-panels'
  | 'licenses'
  | 'provisioning'
  | 'operating-systems'
  | 'images'
  | 'availability'
  | 'dns'
  | 'ssl'
  | 'monitoring'
  | 'logs';

const LINKS: Array<{ key: InfrastructureNavKey; to: string; label: string }> = [
  { key: 'servers', to: '/admin/servers', label: 'Servers' },
  { key: 'control-panels', to: '/admin/control-panels', label: 'Control Panels' },
  { key: 'licenses', to: '/admin/licenses', label: 'Licenses' },
  { key: 'providers', to: '/admin/infrastructure/providers', label: 'Providers & Regions' },
  { key: 'provisioning', to: '/admin/infrastructure/provisioning', label: 'Provisioning Jobs' },
  { key: 'operating-systems', to: '/admin/infrastructure/operating-systems', label: 'Operating Systems' },
  { key: 'images', to: '/admin/infrastructure/images', label: 'OS Images' },
  { key: 'availability', to: '/admin/infrastructure/availability', label: 'Server Templates' },
  { key: 'dns', to: '/admin/dns', label: 'DNS Zones' },
  { key: 'ssl', to: '/admin/ssl', label: 'SSL Certs' },
  { key: 'monitoring', to: '/admin/monitoring', label: 'Monitoring' },
  { key: 'logs', to: '/admin/infrastructure/logs', label: 'Audit & Logs' },
];

/** Single source of truth for the admin infrastructure section navigation. */
export default function InfrastructureNav({ active }: { active?: InfrastructureNavKey }) {
  return (
    <nav className="ch247-infra-nav">
      {LINKS.map((link) => (
        <Link key={link.key} className={link.key === active ? 'is-active' : undefined} to={link.to}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
