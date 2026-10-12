/**
 * English catalogue — the source of truth. Every other catalogue must define the same keys.
 *
 * Plural forms use `<key>.one` and `<key>.other`; `plural()` picks the form with Intl.PluralRules.
 * Placeholders are written `{name}`. Text here is what visitors read, so keep it plain.
 */
export const en = {
  'header.menu.open': 'Open menu',
  'header.menu.close': 'Close menu',
  'header.search.label': 'Search CloudHost247',
  'header.account.dashboard': 'Dashboard',
  'header.account.logout': 'Log out',
  'header.account.fallback': 'Account',
  'header.account.navLabel': 'Account',

  'footer.copyright': '© {year} {legalName} All rights reserved.',
  'footer.legalAndAccount': 'Legal and account',
  'footer.nav.legalCenter': 'Legal & Policy Center',
  'footer.nav.privacy': 'Privacy',
  'footer.nav.cookies': 'Cookies',
  'footer.nav.terms': 'Terms',
  'footer.nav.status': 'Status',
  'footer.nav.help': 'Help',
  'footer.nav.contact': 'Contact',

  'language.switcher.label': 'Language',
  'language.switcher.current': 'Current language: {language}',
  'language.switcher.listLabel': 'Choose a language',
  'language.switcher.count.one': '{count} language available',
  'language.switcher.count.other': '{count} languages available',
  'language.switcher.note': 'More languages are added once their translations have been checked.',
  'currency.switcher.label': 'Display currency',
  'currency.switcher.listLabel': 'Choose a display currency',
  'currency.switcher.note': 'You are charged in USD. Converted amounts are estimates, may differ from your card issuer\u2019s rate, and are not used for billing.',
  'currency.switcher.asOf': 'Rates observed {time}.',
  'currency.switcher.unavailable': 'Other currencies are unavailable right now. Prices are shown in USD.',
  'currency.switcher.approx': 'About {amount}. Charged in USD.',
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<string, string>;
