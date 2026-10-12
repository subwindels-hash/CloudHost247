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
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<string, string>;
