import { useId } from 'react';
import 'flag-icons/css/flag-icons.min.css';
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
      <span className="ch247-country__display" aria-hidden="true">
        {country ? <><span className={`ch247-country__flag fi fi-${country.toLowerCase()}`} /> {country === 'GB' ? 'UK' : country}</> : 'Country'} <span className="ch247-country__arrow">▾</span>
      </span>
      <select id={`${noteId}-select`} className="ch247-country__select" value={country ?? ''} aria-describedby={noteId} onChange={(event) => setCountry(event.target.value)}>
        <option value="" disabled>Choose country</option>
        {countries.map((code) => <option key={code} value={code}>{regionName(code)} ({code === 'GB' ? 'UK' : code})</option>)}
      </select>
      <span id={noteId} className="ch247-country__note">{countrySource === 'detected' ? 'Country is estimated from your IP address; you can change it.' : countrySource === 'selected' ? 'Country selected manually.' : 'Country unavailable. Choose a country.'} Display currencies depend on available rates; billing is not changed.</span>
    </div>
  );
}
