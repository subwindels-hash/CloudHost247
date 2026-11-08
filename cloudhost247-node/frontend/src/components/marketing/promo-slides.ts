/** Promotional copy and local video assets. Publishing changes requires a site build. */
export const PROMO_SLIDES = [
  {
    id: 'domains', category: 'Domains', label: 'A name for what’s next',
    title: 'Find a name for your next big idea.',
    description: 'Find the right domain and give your idea a place to call home.',
    primary: { label: 'Search domains', to: '/domains/search' },
    secondary: { label: 'Explore domains', to: '/domains' },
    support: 'Search and explore domain options with CloudHost247.',
    video: 'domains', tone: 'dark', durationMs: 10000,
  },
  {
    id: 'websites', category: 'Website Builder', label: 'Made for your next move',
    title: 'A little idea can go a long way.',
    description: 'Give your website a home and make space for everything you want to build.',
    primary: { label: 'Explore websites', to: '/websites' },
    secondary: { label: 'Explore hosting', to: '/hosting' },
    support: 'Domains, hosting and tools for your next idea.',
    video: 'people', tone: 'light', durationMs: 10000,
  },
] as const;
