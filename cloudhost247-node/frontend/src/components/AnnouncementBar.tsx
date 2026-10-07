import { Link } from 'react-router-dom';
import { ANNOUNCEMENTS } from '../content/announcements';

/**
 * Site-wide announcement bar: a seamless horizontal scroll of the messages in
 * `content/announcements.ts`.
 *
 * This is the SPA counterpart of `templates/cloudhost247/includes/announcementbar.tpl`, which the
 * WHMCS/PHP surface has had for a while. The technique is deliberately the same one that template
 * uses, because it is the only approach that holds up:
 *
 *   • Two identical groups, translated by exactly -50% → a seamless loop with no gap and no jump,
 *     even with one short message. CSS only: no `<marquee>`, no slider library, no JS timer.
 *   • `animation-play-state: paused` on hover *and* on `:focus-within`, so a keyboard user can
 *     reach a link in a moving track.
 *   • `prefers-reduced-motion` disables the animation entirely and stacks the messages instead of
 *     merely slowing them — a slower scroll is still a moving target.
 *   • The duplicate group is `aria-hidden` and its links are removed from the tab order, so a
 *     screen reader hears each announcement once and Tab does not visit it twice.
 *
 * The star is drawn once in a `<symbol>` and `<use>`d per message: ten copies of an inline SVG with
 * its own gradient ids would put ten identical ids in the document.
 */
function StarSprite() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <linearGradient id="ch-announce-star-face" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#7ff0cd" />
          <stop offset="100%" stopColor="#2fd3a1" />
        </linearGradient>
        <linearGradient id="ch-announce-star-shade" x1="0.2" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#12b886" />
          <stop offset="100%" stopColor="#046b52" />
        </linearGradient>
        <symbol id="ch-announce-star" viewBox="0 0 24 25">
          {/* Five points, each split into a lit and a shaded facet meeting at the centre — the
              cheapest honest way to read as a solid, bevelled star rather than a flat glyph. */}
          <polygon points="12,12.5 9.77,9.43 12,3.5" fill="url(#ch-announce-star-face)" />
          <polygon points="12,12.5 12,3.5 14.23,9.43" fill="url(#ch-announce-star-shade)" />
          <polygon points="12,12.5 14.23,9.43 20.56,9.72" fill="url(#ch-announce-star-face)" />
          <polygon points="12,12.5 20.56,9.72 15.61,13.67" fill="url(#ch-announce-star-shade)" />
          <polygon points="12,12.5 15.61,13.67 17.29,19.78" fill="url(#ch-announce-star-face)" />
          <polygon points="12,12.5 17.29,19.78 12,16.3" fill="url(#ch-announce-star-shade)" />
          <polygon points="12,12.5 12,16.3 6.71,19.78" fill="url(#ch-announce-star-face)" />
          <polygon points="12,12.5 6.71,19.78 8.39,13.67" fill="url(#ch-announce-star-shade)" />
          <polygon points="12,12.5 8.39,13.67 3.44,9.72" fill="url(#ch-announce-star-face)" />
          <polygon points="12,12.5 3.44,9.72 9.77,9.43" fill="url(#ch-announce-star-shade)" />
          {/* Specular highlight: one small facet catching the light sells the depth. */}
          <polygon points="12,12.5 11.2,8.2 12,3.5" fill="#ffffff" opacity="0.55" />
        </symbol>
      </defs>
    </svg>
  );
}

function Star() {
  return (
    <svg className="ch-announce__star" width="18" height="18" aria-hidden="true" focusable="false">
      <use href="#ch-announce-star" />
    </svg>
  );
}

function Group({ clone = false }: { clone?: boolean }) {
  return (
    <ul
      className={`ch-announce__group${clone ? ' ch-announce__group--clone' : ''}`}
      aria-hidden={clone || undefined}
    >
      {ANNOUNCEMENTS.map((item, index) => {
        const key = `${item.text}-${index}`;
        const label = (
          <>
            {item.badge ? <span className="ch-announce__badge">{item.badge}</span> : null}
            <span>{item.text}</span>
          </>
        );
        return (
          <li className="ch-announce__item" key={key}>
            <Star />
            {item.url ? (
              <Link className="ch-announce__link" to={item.url} tabIndex={clone ? -1 : undefined}>
                {label}
              </Link>
            ) : (
              <span className="ch-announce__text">{label}</span>
            )}
            <span className="ch-announce__sep" aria-hidden="true" />
          </li>
        );
      })}
    </ul>
  );
}

export default function AnnouncementBar() {
  if (ANNOUNCEMENTS.length === 0) return null;
  return (
    <div className="ch-announce" role="region" aria-label="Site announcements">
      <StarSprite />
      <div className="ch-announce__viewport">
        <div className="ch-announce__track">
          <Group />
          <Group clone />
        </div>
      </div>
    </div>
  );
}
