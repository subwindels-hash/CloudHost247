/**
 * Site-wide announcement bar messages.
 *
 * Rules for editing this list, because a scrolling bar is the most tempting place in a UI to
 * invent something:
 *
 *   • every entry must link to a route this build actually serves, and
 *   • no entry may state a price, discount, uptime figure, SLA or availability claim that is not
 *     produced by the catalogue or a service page at request time.
 *
 * The WHMCS/PHP surface keeps its own copy of this idea in
 * `templates/cloudhost247/includes/announcementbar-config.tpl`, which ships empty for an
 * administrator to fill. This list is deliberately limited to statements about the site itself,
 * which is why it reads as navigation rather than as promotions. An empty array renders nothing,
 * so removing every entry is a supported way to switch the bar off.
 */
export interface Announcement {
  /** Plain text. No HTML. */
  text: string;
  /** Optional internal route; makes the message a link. */
  url?: string;
  /** Optional short pill, e.g. 'New'. Uppercased by the stylesheet. */
  badge?: string;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    badge: 'Tools',
    text: 'Free DNS, IP, SSL and network diagnostics — no account needed',
    url: '/tools',
  },
  {
    text: 'Search, register and transfer a domain from the same account as your hosting',
    url: '/domains',
  },
  {
    text: 'Every plan is priced from the live catalogue, never a stale price list',
    url: '/hosting',
  },
  {
    badge: 'Passkeys',
    text: 'Sign in with a passkey instead of a password',
    url: '/login',
  },
  {
    text: 'Deployment and platform documentation, published from the same tree that serves it',
    url: '/docs',
  },
];
