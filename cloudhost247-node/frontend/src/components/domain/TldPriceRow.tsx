import { Link } from 'react-router-dom';
import { useApiResource } from '../../lib/useApiResource';
import { useLocale } from '../../i18n/LocaleProvider';
import { formatCurrency } from '../../i18n/format';
import type { ExtensionEntry } from '../../lib/domain-services-api';
import './tld-price-row.css';

/**
 * Popular extension price tags, shown directly under a domain search field.
 *
 * Every price is provider-sourced: the catalogue endpoint returns the registrar's own snapshot
 * (`domain_provider_extension_offerings`), and this component prints exactly that value — it holds
 * no price table of its own. An extension with no published registration price is not shown at all
 * rather than shown with a made-up number, and if the registrar is not connected the row degrades to
 * the "View all" link instead of pretending to know what a domain costs.
 *
 * `POPULAR` only decides *which* real extensions get a tag (the familiar ones first, then whatever
 * else the registrar sells); it never carries a price.
 */

const POPULAR = [
  '.com', '.net', '.org', '.io', '.ai', '.dev', '.app', '.co',
  '.shop', '.store', '.space', '.fun', '.icu', '.top', '.cn', '.online', '.site', '.xyz',
];

// The hero's search column fits four tags plus "View all" on one line; the rest stay one click away.
const LIMIT = 4;

function rank(extension: string) {
  const index = POPULAR.indexOf(extension.toLowerCase());
  return index === -1 ? POPULAR.length : index;
}

export default function TldPriceRow() {
  const { locale } = useLocale();
  const result = useApiResource<{ extensions: ExtensionEntry[] }>('/api/v1/domain-services/extensions');

  const priced = result.status === 'success'
    ? result.data.extensions
      .filter((entry) => entry.registrationPrice !== null && (entry.offeringStatus === null || entry.offeringStatus === 'enabled'))
      .sort((a, b) => rank(a.extension) - rank(b.extension) || a.extension.localeCompare(b.extension))
      .slice(0, LIMIT)
    : [];

  return (
    <nav className="tld-row" aria-label="Popular domain extensions">
      {priced.length > 0 && (
        <ul className="tld-row__list">
          {priced.map((entry) => (
            <li key={entry.id}>
              <Link
                className="tld-chip"
                to={`/domains/extensions?search=${encodeURIComponent(entry.extension.replace(/^\./, ''))}`}
                aria-label={`${entry.extension} domains from ${formatCurrency(Number(entry.registrationPrice), entry.currency ?? 'USD', locale.code)} — see extension pricing`}
              >
                <b aria-hidden="true">{entry.extension}</b>
                <span aria-hidden="true">{formatCurrency(Number(entry.registrationPrice), entry.currency ?? 'USD', locale.code)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link className="tld-row__all" to="/domains/extensions">
        View all <span aria-hidden="true">»</span>
      </Link>
    </nav>
  );
}
