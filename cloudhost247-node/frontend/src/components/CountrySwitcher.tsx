import 'flag-icons/css/flag-icons.min.css';
import { useCurrency } from '../currency/CurrencyProvider';
import { useLocale } from '../i18n/LocaleProvider';

/** Read-only country estimate; display rates and billing remain independently governed. */
export default function CountrySwitcher() {
  const { country, countrySource } = useCurrency();
  const { locale } = useLocale();
  let countryName = country ?? 'unavailable';
  if (country) {
    try { countryName = new Intl.DisplayNames([locale.code], { type: 'region' }).of(country) ?? country; }
    catch { /* Older browsers can still use the country code. */ }
  }
  const note = countrySource === 'detected'
    ? 'Country is estimated from your IP address.'
    : countrySource === 'browser'
      ? 'Country is estimated from your browser settings.'
      : 'Country could not be detected.';
  return (
    <div className="ch247-country" role="status" aria-label={`Country or region: ${countryName}. ${note}`} title={note}>
      <span className="ch247-country__display" aria-hidden="true">
        {country ? <><span className={`ch247-country__flag fi fi-${country.toLowerCase()}`} /> {country === 'GB' ? 'UK' : country}</> : 'Country unavailable'}
      </span>
    </div>
  );
}
