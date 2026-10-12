import { useCurrency } from '../currency/CurrencyProvider';
import { useLocale } from '../i18n/LocaleProvider';

/**
 * A converted estimate printed UNDER the authoritative amount. It renders only when the visitor has
 * chosen a converted display currency and the source is a USD amount with a valid rate. In every other
 * case it renders nothing, so the USD figure is the only figure shown.
 */
export function ApproxAmount({ amount, currency }: { amount: number | string | null | undefined; currency: string }) {
  const { t } = useLocale();
  const { currency: display, formatAmount } = useCurrency();
  if (amount === null || amount === undefined || display === 'USD') return null;
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return null;
  const shown = formatAmount(value, currency);
  if (!shown.converted) return null;
  return (
    <small className="ch247-approx" style={{ display: 'block', fontSize: '0.85em' }}>
      {t('currency.switcher.approx', { amount: shown.text })}
    </small>
  );
}
