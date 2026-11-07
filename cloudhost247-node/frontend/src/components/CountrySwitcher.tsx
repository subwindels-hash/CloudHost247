import { useId } from 'react';
import { COUNTRY_CODES, useCurrency } from '../currency/CurrencyProvider';
import { useLocale } from '../i18n/LocaleProvider';

/** Country is an advisory preference; display rates and billing remain independently governed. */
export default function CountrySwitcher() {
  const { country, countrySource, setCountry } = useCurrency();
  const { locale } = useLocale();
  const noteId = useId();
  let regionName = (code: string) => code;
  try {
    const names = new Intl.DisplayNames([locale.code], { type: 'region' });
    regionName = (code: string) => names.of(code) ?? code;
  } catch { /* Older browsers can still use country codes. */ }
  const countries = [...COUNTRY_CODES].sort((a, b) => regionName(a).localeCompare(regionName(b), locale.code));
  return (
    <div className="ch247-country">
      <label className="ch247-country__label" htmlFor={`${noteId}-select`}>Country or region</label>
      <select id={`${noteId}-select`} className="ch247-country__select" value={country ?? ''} aria-describedby={noteId} onChange={(event) => setCountry(event.target.value)}>
        <option value="" disabled>Region</option>
        {countries.map((code) => <option key={code} value={code}>{regionName(code)}</option>)}
      </select>
      <span id={noteId} className="ch247-country__note">{countrySource === 'detected' ? 'Region is estimated from browser settings or a network hint; you can change it.' : 'Choose a region to suggest an available display currency. Billing is not changed.'}</span>
    </div>
  );
}
