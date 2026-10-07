/**
 * CloudHost247 icon set.
 *
 * One stroke style, one grid (24×24), one stroke width — so an icon pulled from the mega menu,
 * a feature card, a footer link and a status row all look like they came from the same company,
 * because they did.
 *
 * Icons are inline SVG with no external sprite or icon-font request: the menu is usable before
 * any additional network round trip completes, which matters most on the megamenu, where a
 * missing icon file is a visibly broken panel.
 *
 * Decorative by default (`aria-hidden`); pass `title` only when the icon is the sole carrier of
 * meaning, which for this site it never is.
 *
 * The name list is validated at generation time — `scripts/site/generate.mjs` fails the build if
 * content references an icon that does not exist here, so a typo becomes a build error rather
 * than a blank square.
 */
import type { SVGProps } from 'react';

export type IconName =
  | 'activity' | 'alert' | 'api' | 'app' | 'book' | 'book-open' | 'box' | 'briefcase' | 'building'
  | 'cart' | 'chart' | 'clock' | 'cloud' | 'cloud-lock' | 'code' | 'control' | 'cookie' | 'cpu'
  | 'database' | 'data-center' | 'dns' | 'docker' | 'domain' | 'eye' | 'file-text' | 'firewall'
  | 'folder' | 'gamepad' | 'gauge' | 'git-branch' | 'globe' | 'grid' | 'handshake' | 'hard-drive'
  | 'headset' | 'help' | 'invoice' | 'ip' | 'key' | 'laravel' | 'layers' | 'layout' | 'life-buoy'
  | 'list' | 'lock' | 'mail' | 'megaphone' | 'network' | 'news' | 'nodejs' | 'os' | 'pen' | 'php'
  | 'pulse' | 'python' | 'puzzle' | 'refresh' | 'rocket' | 'scale' | 'search' | 'server'
  | 'server-rack' | 'settings' | 'shield' | 'sparkle' | 'star' | 'tag' | 'terminal' | 'ticket'
  | 'tools' | 'transfer' | 'user' | 'users' | 'windows' | 'wordpress' | 'wrench' | 'zap';

/** Path data, drawn on a 24×24 grid with `fill="none"` and `stroke="currentColor"`. */
const PATHS: Record<IconName, string> = {
  activity: 'M3 12h4l2.5-7 4 14L16 12h5',
  alert: 'M12 4l9 16H3l9-16Zm0 5v5m0 3v.01',
  api: 'M8 4H5v16h3M16 4h3v16h-3M10 9l4 6m0-6l-4 6',
  app: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 14v6M13.5 17h6',
  book: 'M5 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H5V4Zm14 0h-5v13.5h3A3 3 0 0 1 19 20V4Z',
  'book-open': 'M12 7c-2-1.7-5-2-8-2v13c3 0 6 .3 8 2 2-1.7 5-2 8-2V5c-3 0-6 .3-8 2Zm0 0v13',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 0l8-4.5M12 12L4 7.5',
  briefcase: 'M4 8h16v11H4V8Zm5 0V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 12h16',
  building: 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 10h3a1 1 0 0 1 1 1v10M9 7h2M9 11h2M9 15h2M3 21h18',
  cart: 'M3 5h2l2.4 10.5h11L21 8H6M9 20.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm8.5 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z',
  chart: 'M4 20V5M4 20h16M8 17v-5m4 5V8m4 9v-3m4 3V6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.5V12l3.5 2',
  cloud: 'M7.5 19a4.5 4.5 0 0 1-.6-8.95 6 6 0 0 1 11.5 1.2A4.4 4.4 0 0 1 17.5 19h-10Z',
  'cloud-lock': 'M7.5 18a4.5 4.5 0 0 1-.6-8.95 6 6 0 0 1 11.5 1.2A4.4 4.4 0 0 1 17 18M10 13.5h4.5v4H10zM11 13.5V12a1.5 1.5 0 0 1 3 0v1.5',
  code: 'M9 8l-5 4 5 4m6-8 5 4-5 4M13.5 5l-3 14',
  control: 'M6 4v6m0 4v6M12 4v3m0 4v9M18 4v9m0 4v3M3.5 10h5M9.5 7h5m0 9h5',
  cookie: 'M12 3a9 9 0 1 0 9 9 4 4 0 0 1-5-5 4 4 0 0 0-4-4Zm-3 5v.01M8 15v.01M13 16v.01M16 12v.01',
  cpu: 'M6 6h12v12H6zM10 10h4v4h-4zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3',
  database: 'M12 3.5c4.4 0 7 1.2 7 2.5S16.4 8.5 12 8.5 5 7.3 5 6s2.6-2.5 7-2.5ZM5 6v12c0 1.4 2.6 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 2.6 2.5 7 2.5s7-1.1 7-2.5',
  'data-center': 'M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4',
  dns: 'M4 6h16v5H4zM4 13h16v5H4zM8 8.5h3m-3 7h3M16 8.5h.01M16 15.5h.01',
  docker: 'M4 10h3v3H4zM8 10h3v3H8zM12 10h3v3h-3zM8 6h3v3H8zM12 6h3v3h-3zM16 6h3v3h-3zM16 10h3v3h-3zM3 15c2 3 6 4 10 3.2 3.6-.7 6-3 7-6.2h-2.5M2.5 15h13.5',
  domain: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.6 3 2.6 15 0 18m0-18c-2.6 3-2.6 15 0 18M3.4 9h17.2M3.4 15h17.2',
  eye: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Zm9.5 2.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  'file-text': 'M6 3h8l4 4v14H6V3Zm8 0v4h4M9 12h6M9 16h6',
  firewall: 'M4 4h16v6H4zM4 14h16v6H4zM4 10v4M20 10v4M9 4v6m6 0v6m-9 4v2m6-6v6',
  folder: 'M4 6h5l2 2.5h9V19H4V6Z',
  gamepad: 'M8.5 8h7a5 5 0 0 1 4.9 6l-.7 3.2A2.6 2.6 0 0 1 14.6 18l-.9-1h-3.4l-.9 1a2.6 2.6 0 0 1-5.1-1.2L3.6 14A5 5 0 0 1 8.5 8ZM7 11.5v3M5.5 13h3M15 12.5h.01M17.5 14.5h.01',
  gauge: 'M12 20a8 8 0 1 1 8-8M12 12l4.5-3M12 12v.01',
  'git-branch': 'M6 4v12a3 3 0 0 0 3 3h5M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0-4V9a2 2 0 0 0-2-2h-3',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.6 3 2.6 15 0 18m0-18c-2.6 3-2.6 15 0 18M3 12h18',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  handshake: 'M8 12l2.5-2.5L13 12l3-3 4.5 4.5-5 5-3-3-3 3-4.5-4.5L8 12Zm-2.5-1 3-3 3 3M4 9.5l3-3',
  'hard-drive': 'M4 6h16v12H4zM7 10.5h.01M7 13.5h.01M10 12h7',
  headset: 'M4 13a8 8 0 0 1 16 0M4 13v2a3 3 0 0 0 3 3h1v-7H6a2 2 0 0 0-2 2Zm16 0v2a3 3 0 0 1-3 3h-2',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-2 7a2 2 0 1 1 3 1.7c-.7.5-1 1-1 1.8m0 3v.01',
  invoice: 'M6 3h9l3 3v15l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 15h4',
  ip: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h4m-4 8h4m6 0h1M18 8h1',
  key: 'M8 14.5a4.5 4.5 0 1 1 4.2-6.1L21 9.5v3h-2.5v3H15v-2.6l-2 1.4A4.5 4.5 0 0 1 8 14.5Zm0-2.2v.01',
  laravel: 'M3 15.5 8 6l4.5 8M8 6l5.5 9.5M13.5 14 21 9.5V15L13 20v-5.5ZM13 10l4-2.5',
  layers: 'M12 3l9 4.5-9 4.5-9-4.5L12 3Zm-9 9 9 4.5 9-4.5m-18 4.5L12 21l9-4.5',
  layout: 'M4 5h16v14H4zM4 10h16M10 10v9',
  'life-buoy': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM6 6l3.2 3.2M18 6l-3.2 3.2M6 18l3.2-3.2M18 18l-3.2-3.2',
  list: 'M4 6h16M4 12h16M4 18h16',
  lock: 'M6 10.5h12V20H6v-9.5ZM8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5M12 14.5v2',
  mail: 'M3 6h18v12H3V6Zm.5.8L12 13l8.5-6.2',
  megaphone: 'M4 10v4a2 2 0 0 0 2 2h1l9 4V6L7 10H6a2 2 0 0 0-2 2Zm14-1a4 4 0 0 1 0 6M8 16v4',
  network: 'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm14 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 9v3M12 12l-5 3M12 12l5 3',
  news: 'M4 5h13v14H4V5Zm13 4h3v8a2 2 0 0 1-2 2M7 9h7M7 12h7M7 15h4',
  nodejs: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm-3 7v4.5a1.5 1.5 0 0 0 3 0V10m3 0v7',
  os: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 14v5M14 16.5h5',
  pen: 'M4 20l4-1L19 8l-3-3L5 16l-1 4Zm11-14 3 3',
  php: 'M12 3c5.5 0 9.5 1.8 9.5 4S17.5 13 12 13 2.5 9.2 2.5 7 6.5 3 12 3Zm-2 6.5v6M8 10.5h2a1.5 1.5 0 0 1 0 3H8m5.5-3v6m0-3h2a1.5 1.5 0 0 0 0-3h-2M6 16h12',
  pulse: 'M3 12h4l2-6 3 12 2.5-6H21',
  python: 'M12 3c-3 0-4 1-4 2.5V8h8v1H6.5C4.5 9 3 10.5 3 13s1.5 4 3.5 4H8v-2.5c0-2 1-3 3-3h6c1.5 0 2.5-1 2.5-2.5V5.5C19.5 4 17.5 3 15 3h-3Zm-2 1.2v.01M14 20.8v-.01M12 21c3 0 4-1 4-2.5V16H8v-1h9.5c2 0 3.5-1.5 3.5-4s-1.5-4-3.5-4H16v2.5c0 2-1 3-3 3H7c-1.5 0-2.5 1-2.5 2.5v3C4.5 20 6.5 21 9 21h3Z',
  puzzle: 'M10 4a2 2 0 0 1 4 0v1.5h3.5V9H19a2 2 0 0 1 0 4h-1.5v4h-4v-1.5a2 2 0 0 0-4 0V17h-4v-4H7a2 2 0 0 1 0-4h-1.5V5.5H10V4Z',
  refresh: 'M20 11a8 8 0 0 0-13.7-4.6L3 9m1-4v4h4M4 13a8 8 0 0 0 13.7 4.6L21 15m-1 4v-4h-4',
  rocket: 'M12 15c-1.5-4.5.5-9.5 5-12 .8 4.8-1.5 9.5-5 12Zm0 0c-2 .5-4 2-4.5 4.5C10 19 11.5 17 12 15ZM7 12c-1.8.2-3.4 1.2-4.5 3 1.8.3 3.3.1 4.5-.5',
  scale: 'M12 4v16M7 20h10M12 6 6 8l-2.5 5a3.2 3.2 0 0 0 5 0L6 8m6-2 6 2 2.5 5a3.2 3.2 0 0 1-5 0L18 8',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 5 5',
  server: 'M4 4h16v7H4zM4 13h16v7H4zM8 7.5h.01M8 16.5h.01M12 7.5h5M12 16.5h5',
  'server-rack': 'M3 4h18v5H3zM3 11h18v5H3zM3 18h18v3H3zM7 6.5h3m-3 3.5h3m-3 3.5h3M16 6.5h3M16 10h3M16 19.5h3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3a8 8 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.2-1.3L15 3H9l-.4 2.5a8 8 0 0 0-2.2 1.3l-2.3-1-2 3.4 2 1.5A8 8 0 0 0 4 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.2 1.3L9 21h6l.4-2.5a8 8 0 0 0 2.2-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z',
  shield: 'M12 3l7.5 3v6c0 5-3.5 7.6-7.5 9.5C8 19.6 4.5 17 4.5 12V6L12 3Zm-3 9 2.2 2.2L16 9.5',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 11 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
  star: 'M12 3.5l2.7 5.6 6 .9-4.3 4.3 1 6-5.4-2.9-5.4 2.9 1-6L3.3 10l6-.9L12 3.5Z',
  tag: 'M4 11V4h7l9 9-7 7-9-9Zm3.5-4v.01',
  terminal: 'M4 4h16v16H4zM7.5 9.5 10 12l-2.5 2.5M12 15h4.5',
  ticket: 'M4 6h16v3.5a2.5 2.5 0 0 0 0 5V18H4v-3.5a2.5 2.5 0 0 0 0-5V6Zm8 1v10',
  tools: 'M14.5 4a5 5 0 0 0-4.6 7L4 16.9 7.1 20l5.9-5.9A5 5 0 0 0 20 9.5l-3 1-2-2 1-3a5 5 0 0 0-1.5-1.5ZM7 17l.01.01',
  transfer: 'M4 8h13l-3-3m3 3-3 3M20 16H7l3 3m-3-3 3-3',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-7 17c1.2-3.7 3.8-5.5 7-5.5s5.8 1.8 7 5.5',
  users: 'M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm-6.5 16c1-3.3 3.3-5 6.5-5s5.5 1.7 6.5 5M16.5 5.5a3 3 0 0 1 0 5.6M18 14.6c2 .5 3.3 2 4 4.4',
  windows: 'M4 5.5 11 4.5v6.7H4V5.5Zm8.5-1.2L20.5 3v8.2h-8V4.3ZM4 12.7h7v6.8l-7-1V12.7Zm8.5 0h8V21l-8-1.2v-7.1Z',
  wordpress: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-6 5 2.2 8L10 9M12 8h1.5m5.5.5c-1.4 6-1.6 6.6-2.6 9.5l-2-6.2M6.5 8h3',
  wrench: 'M15 4a5 5 0 0 0-4.4 7.4L4 18l2 2 6.6-6.6A5 5 0 0 0 20 9l-2.5 1-1.5-1.5L17 6c-.6-.7-1.3-1.3-2-2ZM6 19l.01.01',
  zap: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName | string;
  size?: number;
  /** Only set this when the icon carries meaning that no adjacent text does. */
  title?: string;
}

export function Icon({ name, size = 24, title, className, ...rest }: IconProps) {
  const path = PATHS[name as IconName] ?? PATHS.wrench;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={path} />
    </svg>
  );
}

/** A checkmark, used where a list of guarantees or capabilities is being asserted. */
export function CheckIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden focusable="false">
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

/** A right-pointing arrow for "read more" affordances. */
export function ArrowIcon({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden focusable="false">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** The CloudHost247 mark: a stacked isometric cube pair reading as a rack and a cloud. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="ch-brand-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7ff0b4" />
          <stop offset="100%" stopColor="#2fd58a" />
        </linearGradient>
      </defs>
      <path d="M16 3.5 27 10v12L16 28.5 5 22V10L16 3.5Z" fill="none" stroke="url(#ch-brand-a)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M5 10l11 6.5L27 10M16 16.5v12" fill="none" stroke="url(#ch-brand-a)" strokeWidth="1.1" opacity="0.75" />
      <circle cx="16" cy="16.5" r="2.1" fill="url(#ch-brand-a)" />
    </svg>
  );
}

export default Icon;
