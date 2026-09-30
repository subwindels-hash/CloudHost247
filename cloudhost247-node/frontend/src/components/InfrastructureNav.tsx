import { Link } from 'react-router-dom';

export type InfrastructureNavKey =
  | 'operating-systems'
  | 'images'
  | 'providers'
  | 'availability'
  | 'provisioning'
  | 'logs';

const LINKS: Array<{ key: InfrastructureNavKey; to: string; label: string }> = [
  { key: 'operating-systems', to: '/admin/infrastructure/operating-systems', label: 'Operating systems' },
  { key: 'images', to: '/admin/infrastructure/images', label: 'OS images' },
  { key: 'providers', to: '/admin/infrastructure/providers', label: 'Providers & regions' },
  { key: 'availability', to: '/admin/infrastructure/availability', label: 'Availability' },
  { key: 'provisioning', to: '/admin/infrastructure/provisioning', label: 'Provisioning' },
  { key: 'logs', to: '/admin/infrastructure/logs', label: 'Infrastructure logs' },
];

/** Single source of truth for the admin infrastructure section navigation. */
export default function InfrastructureNav({ active }: { active: InfrastructureNavKey }) {
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
