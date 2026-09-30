import { useMemo, useState } from 'react';
import type { AvailableOperatingSystem, AvailableOsVersion } from '../lib/infrastructure-api';

interface Props {
  operatingSystems: AvailableOperatingSystem[];
  selectedOsId: string;
  selectedVersionId: string;
  selectedArchitecture: string;
  onOsChange: (id: string) => void;
  onVersionChange: (id: string) => void;
  onArchitectureChange: (architecture: 'x86_64'|'arm64') => void;
}

export default function OperatingSystemSelector(props: Props) {
  const [search,setSearch] = useState('');
  const systems = useMemo(() => props.operatingSystems.filter((os) =>
    `${os.name} ${os.vendor ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
  ),[props.operatingSystems,search]);
  const selected = props.operatingSystems.find((os) => os.id === props.selectedOsId) ?? null;
  const version = selected?.versions.find((item) => item.id === props.selectedVersionId) ?? null;

  function chooseOs(os: AvailableOperatingSystem) {
    props.onOsChange(os.id);
    const next = os.versions.find((item) => item.default)
      ?? os.versions.find((item) => item.recommended)
      ?? os.versions[0];
    props.onVersionChange(next?.id ?? '');
    if (next?.architectures.length === 1) props.onArchitectureChange(next.architectures[0] as 'x86_64'|'arm64');
  }

  function chooseVersion(next: AvailableOsVersion) {
    props.onVersionChange(next.id);
    if (!next.architectures.includes(props.selectedArchitecture as 'x86_64'|'arm64')) {
      props.onArchitectureChange(next.architectures[0] ?? 'x86_64');
    }
  }

  return (
    <section className="ch247-os-selector" aria-labelledby="os-selector-title">
      <div className="ch247-os-selector__head">
        <div>
          <h2 id="os-selector-title">Operating system</h2>
          <p className="ch247-page__hint">Only verified images available for this plan and location are shown.</p>
        </div>
        <label className="ch247-field ch247-os-search">
          <span>Search operating systems</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Ubuntu, Debian…" />
        </label>
      </div>

      {systems.length === 0 ? (
        <p className="ch247-banner ch247-banner--warning">No operating systems match this search and configuration.</p>
      ) : (
        <div className="ch247-os-grid" role="listbox" aria-label="Operating systems">
          {systems.map((os) => (
            <button
              key={os.id}
              type="button"
              role="option"
              aria-selected={os.id === props.selectedOsId}
              className={`ch247-os-card ${os.id === props.selectedOsId ? 'is-selected' : ''}`}
              onClick={() => chooseOs(os)}
            >
              {os.logoUrl ? <img src={os.logoUrl} alt="" /> : <span className="ch247-os-card__fallback" aria-hidden="true">{os.name.slice(0,2).toUpperCase()}</span>}
              <span className="ch247-os-card__copy">
                <strong>{os.name}</strong>
                <small>{os.vendor ?? 'Linux'} · {os.versions.length} {os.versions.length === 1 ? 'version' : 'versions'}</small>
              </span>
              <span className="ch247-os-card__check" aria-hidden="true">✓</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="ch247-os-options">
          <label className="ch247-field">
            Version
            <select value={props.selectedVersionId} onChange={(event) => {
              const next = selected.versions.find((item) => item.id === event.target.value);
              if (next) chooseVersion(next);
            }}>
              {selected.versions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}{item.recommended ? ' — Recommended' : ''}{item.status === 'EOL_WARNING' ? ' — EOL warning' : ''}
                </option>
              ))}
            </select>
          </label>
          {version && (
            <fieldset className="ch247-fieldset ch247-architecture-selector">
              <legend>Architecture</legend>
              {version.architectures.map((item) => (
                <label key={item}>
                  <input type="radio" name="architecture" value={item} checked={props.selectedArchitecture === item} onChange={() => props.onArchitectureChange(item)} />
                  {item === 'arm64' ? 'ARM64' : 'x86_64'}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
