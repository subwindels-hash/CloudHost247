import { Icon } from '../ui/Icon';
import './assurance-strip.css';

/**
 * Service-assurance strip — the five promises in one white card directly under the pricing section.
 *
 * COPY IS OWNER-AUTHORED, NOT DERIVED FROM DATA. Every string below is a business claim made by
 * the operator, so it lives here as a literal and is deliberately not fetched or formatted at
 * runtime. Two of them are load-bearing legally, so before changing them read:
 *   • "30-Day Money Back Guarantee" — refund-policy.php scopes the 30-day full refund to shared
 *     and reseller hosting; other products follow the policy's own terms.
 *   • "99.9% Uptime Guarantee" — Terms of Service §6 says the platform *aims* for 99.9% uptime
 *     and explicitly "does not guarantee uninterrupted service". The badge states a guarantee the
 *     ToS disclaims; the operator owns that decision.
 *
 * Icons are drawn rather than emoji so the strip keeps the same 24×24 grid and stroke weight as
 * the rest of the icon set: two filled marks, two outline marks, and one gold seal.
 */

const ITEMS = [
  { id: 'ssl', lines: ['Free SSL', 'Certificate'] },
  { id: 'speed', lines: ['Ultra Fast', 'Performance'] },
  { id: 'uptime', lines: ['99.9% Uptime', 'Guarantee'] },
  { id: 'refund', lines: ['30-Day Money', 'Back Guarantee'] },
  { id: 'support', lines: ['24/7 Expert', 'Support'] },
] as const;

type ItemId = (typeof ITEMS)[number]['id'];

/** Filled shield with a knocked-out check. */
function ShieldCheck() {
  return (
    <svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true" focusable="false">
      <path d="M12 2.4 19.6 5.4v6.2c0 4.8-3.2 8.8-7.6 10.6C7.6 20.4 4.4 16.4 4.4 11.6V5.4L12 2.4Z" fill="currentColor" />
      <path d="m8.5 11.9 2.5 2.6 4.6-5.2" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Two stacked server units with a status check badge. */
function ServerCheck() {
  return (
    <svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true" focusable="false">
      <rect x="3.1" y="4.4" width="17.8" height="6.4" rx="1.9" fill="currentColor" />
      <rect x="3.1" y="12.8" width="17.8" height="6.4" rx="1.9" fill="currentColor" />
      <circle cx="6.6" cy="7.6" r="1.05" fill="#fff" />
      <circle cx="6.6" cy="16" r="1.05" fill="#fff" />
      <path d="M10.6 7.6h7.2M10.6 16h3.2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="18.6" cy="18.4" r="4.2" fill="#fff" />
      <path d="m16.7 18.4 1.4 1.4 2.4-2.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Gold money-back seal: a scalloped ring with a struck-through dollar mark. */
function RefundSeal() {
  const seal = 'M12 1.4 13.16 3.18 14.74 1.76 15.41 3.78 17.3 2.82 17.42 4.94 19.5 4.5 19.06 6.58 21.18 6.7 20.22 8.59 22.24 9.26 20.82 10.84 22.6 12 20.82 13.16 22.24 14.74 20.22 15.41 21.18 17.3 19.06 17.42 19.5 19.5 17.42 19.06 17.3 21.18 15.41 20.22 14.74 22.24 13.16 20.82 12 22.6 10.84 20.82 9.26 22.24 8.59 20.22 6.7 21.18 6.58 19.06 4.5 19.5 4.94 17.42 2.82 17.3 3.78 15.41 1.76 14.74 3.18 13.16 1.4 12 3.18 10.84 1.76 9.26 3.78 8.59 2.82 6.7 4.94 6.58 4.5 4.5 6.58 4.94 6.7 2.82 8.59 3.78 9.26 1.76 10.84 3.18Z';
  return (
    <svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true" focusable="false">
      <path d={seal} fill="currentColor" />
      <path d="M12 7.4v9.2M14.4 9.2a2.6 2.6 0 0 0-2.4-1c-1.4 0-2.4.8-2.4 2s1 1.6 2.4 1.9 2.4.7 2.4 1.9-1 2-2.4 2a2.7 2.7 0 0 1-2.5-1.1" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Glyph({ id }: { id: ItemId }) {
  switch (id) {
    case 'ssl': return <ShieldCheck />;
    case 'speed': return <Icon name="rocket" size={38} />;
    case 'uptime': return <ServerCheck />;
    case 'refund': return <RefundSeal />;
    case 'support': return <Icon name="headset" size={38} />;
  }
}

export default function AssuranceStrip() {
  return (
    <section className="assurance" aria-label="Included with every plan">
      <ul className="assurance__panel">
        {ITEMS.map((item) => (
          <li className={`assurance__item assurance__item--${item.id}`} key={item.id}>
            <span className="assurance__icon" aria-hidden="true"><Glyph id={item.id} /></span>
            {/* The break is authored, not left to the browser: every badge reads as two lines, the way
                the reference bar does, at any width where the five sit side by side. */}
            <span className="assurance__label">{item.lines[0]} <br />{item.lines[1]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
