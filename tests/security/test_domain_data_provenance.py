"""The domain platform's numbers must come from the connected provider, not from the repository.

The brief asks for a domain platform built on real registrar, TLD and pricing data — and forbids
invented data. §3.9 of the audit report verifies that behaviour by inspection; this module turns the
load-bearing parts of it into rules, so a future edit cannot quietly stock the catalogue:

  * **no price literal beside a TLD** anywhere in first-party source — a plausible price table is
    exactly what a marketing site grows when nobody is looking;
  * **nothing seeds the catalogues** — a migration or seed file that inserts an extension or an
    offering would make a fresh install look stocked before any registrar is connected;
  * **the only writer of provider offerings is the sync service**, which reads the provider's own
    `getExtensions()` — prices and currency are copied from the registrar, never authored;
  * **the pages keep their honest empty state** — the extension directory says the catalogue is
    provider-synchronized and that none is invented, and the directory query only returns offerings
    from a *connected* provider;
  * **the services still fail closed** — search, WHOIS and appraisal keep the
    `provider_not_configured` outcome, which is what stops an unconfigured platform from answering
    with a guess.

Every rule has a negative case that mutates a copy and requires the rule to fire: a check that
cannot fail is not a check. Runs in the security/static suite, with no PHP, no Node and no network.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

NODE = ROOT / 'cloudhost247-node'
EXTENSIONS_SERVICE = NODE / 'src' / 'domain-services' / 'extensions-service.ts'
PROVIDER_SERVICE = NODE / 'src' / 'domain-services' / 'provider-service.ts'
FAIL_CLOSED_SERVICES = (
    NODE / 'src' / 'domain-services' / 'search-service.ts',
    NODE / 'src' / 'domain-services' / 'whois-service.ts',
    NODE / 'src' / 'domain-services' / 'appraisal-service.ts',
)
EXTENSIONS_PAGE = NODE / 'frontend' / 'src' / 'pages' / 'domains' / 'ExtensionsPage.tsx'

# Where a fabricated price could hide: everything first-party that a visitor eventually sees or that
# configures what they see. Tests and mocks are excluded on purpose — a mock registrar quoting a
# price is a fixture, not a claim.
SCAN_ROOTS = (
    'cloudhost247-node/src',
    'cloudhost247-node/frontend/src',
    'cloudhost247-node/database',
    'modules/addons/cloudhost247_theme',
    'templates/cloudhost247',
    'shared/site',
    'tools',
)
SKIP_PARTS = ('node_modules', 'tests', '__tests__', 'dist', 'build', 'coverage')
SKIP_SUFFIXES = ('.png', '.jpg', '.jpeg', '.avif', '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.pdf', '.zip')

TLD = r'\.(?:com|net|org|io|ai|dev|co|app|xyz|store|online|site|tech|cloud|host|info|biz|me|ng)\b'
MONEY = r'(?:[$£€₦]\s?\d{2,}(?:[.,]\d{2})?|\b\d+[.,]\d{2}\s?(?:USD|EUR|GBP|NGN))'
PRICE_BESIDE_TLD = re.compile(
    rf'(?:{TLD}[^\n]{{0,50}}?{MONEY})|(?:{MONEY}[^\n]{{0,50}}?{TLD})',
    re.IGNORECASE,
)

CATALOGUE_TABLES = ('domain_extensions', 'domain_provider_extension_offerings')
SQL_WRITE = re.compile(r'INSERT\s+INTO\s+(?:domain_extensions|domain_provider_extension_offerings)\b', re.I)
OFFERING_INSERT = re.compile(r'INSERT\s+INTO\s+domain_provider_extension_offerings\b', re.I)


def price_literal_problems(documents: dict[str, str]) -> list[str]:
    """Report a TLD name and a price-shaped amount sitting on the same line."""
    found: list[str] = []
    for label, text in documents.items():
        for match in PRICE_BESIDE_TLD.finditer(text):
            line = text.count('\n', 0, match.start()) + 1
            found.append(f'{label}:{line} ties a TLD to a price literal: {match.group(0).strip()!r}')
    return found


def seeded_catalogue_problems(sql_files: dict[str, str]) -> list[str]:
    """Report any migration or seed that writes a domain extension or an offering into the database."""
    return [
        f'{label} seeds the domain catalogue with {SQL_WRITE.search(text).group(0)!r}'
        for label, text in sql_files.items()
        if SQL_WRITE.search(text)
    ]


def catalogue_writer_problems(writers: dict[str, str]) -> list[str]:
    """The provider offerings must be written only by the sync service, and only from the provider."""
    found: list[str] = []
    offenders = sorted(label for label, text in writers.items() if OFFERING_INSERT.search(text))
    expected = 'cloudhost247-node/src/domain-services/extensions-service.ts'
    if offenders != [expected]:
        found.append(f'provider extension offerings are written by {offenders}, not only by {expected}')
    source = writers.get(expected, '')
    if 'syncExtensionsFromProvider' not in source:
        found.append(f'{expected} no longer exports the provider sync the offerings come from')
    if 'getExtensions(' not in source:
        found.append(f'{expected} no longer reads the connected provider extension catalogue')
    if not re.search(r'p\.status\s*=\s*\'connected\'', source):
        found.append(f'{expected} no longer requires a connected provider')
    return found


def honest_directory_problems(documents: dict[str, str]) -> list[str]:
    """The directory page must keep saying where its catalogue comes from, and must invent nothing."""
    found: list[str] = []
    label = 'cloudhost247-node/frontend/src/pages/domains/ExtensionsPage.tsx'
    page = documents.get(label, '')
    if not page:
        found.append(f'{label} is missing')
        return found
    for sentence in ('none are invented here', 'synchronized from the connected registrar'):
        if sentence not in page:
            found.append(f'{label} no longer tells the visitor: {sentence!r}')
    if 'provider-missing' not in page:
        found.append(f'{label} no longer renders the provider-missing state')
    return found


def fail_closed_problems(documents: dict[str, str]) -> list[str]:
    """An unconfigured provider must produce an explicit outcome, never a guess.

    Two different jobs, so two different rules: the services that answer a visitor must name the
    unconfigured outcome, and the resolver must only ever hand back a connection-tested provider.
    """
    found: list[str] = []
    for label, text in documents.items():
        if label.endswith('provider-service.ts'):
            if 'findConnectedDomainServiceProvider' not in text:
                found.append(f'{label} no longer resolves a connection-tested provider')
            continue
        if 'provider_not_configured' not in text:
            found.append(f'{label} no longer distinguishes the unconfigured-provider outcome')
    return found


def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8', errors='ignore')


def scan_documents() -> dict[str, str]:
    """Every first-party document a price literal could hide in, keyed by repository path."""
    documents: dict[str, str] = {}
    for root in SCAN_ROOTS:
        base = ROOT / root
        if not base.exists():
            continue
        for path in sorted(base.rglob('*')):
            if not path.is_file() or path.suffix.lower() in SKIP_SUFFIXES:
                continue
            if any(part in SKIP_PARTS for part in path.parts):
                continue
            documents[path.relative_to(ROOT).as_posix()] = _read(path)
    return documents


def sql_documents() -> dict[str, str]:
    documents = {}
    for base in (NODE / 'database' / 'migrations', NODE / 'database' / 'seed'):
        if not base.exists():
            continue
        for path in sorted(base.rglob('*.sql')):
            documents[path.relative_to(ROOT).as_posix()] = _read(path)
    return documents


def domain_service_documents() -> dict[str, str]:
    """The service files that decide whether an unconfigured domain platform answers honestly."""
    paths = (*FAIL_CLOSED_SERVICES, PROVIDER_SERVICE)
    return {path.relative_to(ROOT).as_posix(): _read(path) for path in paths if path.is_file()}


class DomainPriceLiteralTests(unittest.TestCase):
    def test_no_first_party_source_ties_a_tld_to_a_price(self) -> None:
        documents = scan_documents()
        self.assertGreater(len(documents), 200, 'the sweep found suspiciously few documents')
        self.assertEqual(price_literal_problems(documents), [])

    def test_the_sweep_covers_the_surfaces_that_matter(self) -> None:
        documents = scan_documents()
        for path in (
            'cloudhost247-node/src/domain-services/extensions-service.ts',
            'cloudhost247-node/frontend/src/pages/domains/ExtensionsPage.tsx',
            'shared/site/registry.json',
        ):
            self.assertIn(path, documents)

    def test_a_tld_price_literal_is_reported(self) -> None:
        found = price_literal_problems({'page.html': '<li><strong>.com</strong> — $12.99/yr</li>'})
        self.assertGreaterEqual(len(found), 1, found)

    def test_a_placeholder_or_a_bare_number_is_not_reported(self) -> None:
        documents = {
            'sql.ts': "VALUES ($1, $2, COALESCE($3,'https://api.example.com'))",
            'counts.ts': 'the .com zone held 4000000 rows',
            'plan.json': '"price": "12.99", "currency": "USD"',
        }
        self.assertEqual(price_literal_problems(documents), [])


class DomainCatalogueSourceTests(unittest.TestCase):
    def test_nothing_seeds_the_domain_catalogues(self) -> None:
        documents = sql_documents()
        self.assertGreater(len(documents), 50, 'the migration scan found suspiciously few files')
        self.assertEqual(seeded_catalogue_problems(documents), [])

    def test_only_the_sync_service_writes_provider_offerings(self) -> None:
        documents = scan_documents()
        writers = {
            label: text for label, text in documents.items()
            if 'domain-services' in label or 'domain_services' in label
        }
        self.assertEqual(catalogue_writer_problems(writers), [])

    def test_the_sync_reads_the_connected_provider(self) -> None:
        documents = scan_documents()
        source = documents['cloudhost247-node/src/domain-services/extensions-service.ts']
        self.assertIn('provider.adapter.getExtensions(', source)
        self.assertIn("status = 'connected'", source)

    def test_an_insert_into_a_migration_is_reported(self) -> None:
        found = seeded_catalogue_problems({
            'database/migrations/9999_seed_tlds.sql': "INSERT INTO domain_extensions (extension) VALUES ('com');",
        })
        self.assertGreaterEqual(len(found), 1, found)

    def test_a_second_writer_of_offerings_is_reported(self) -> None:
        writers = {
            'cloudhost247-node/src/domain-services/extensions-service.ts': _read(EXTENSIONS_SERVICE),
            'cloudhost247-node/src/domain-services/shortcut.ts': (
                'INSERT INTO domain_provider_extension_offerings (extension_id) VALUES ($1)'
            ),
        }
        found = catalogue_writer_problems(writers)
        self.assertTrue(any('written by' in item for item in found), found)

    def test_a_sync_that_stops_reading_the_provider_is_reported(self) -> None:
        source = _read(EXTENSIONS_SERVICE).replace('provider.adapter.getExtensions(', 'readNothing(')
        found = catalogue_writer_problems({
            'cloudhost247-node/src/domain-services/extensions-service.ts': source,
        })
        self.assertTrue(any('no longer reads the connected provider' in item for item in found), found)


class DomainHonestStateTests(unittest.TestCase):
    def test_the_directory_states_where_its_catalogue_comes_from(self) -> None:
        page = _read(EXTENSIONS_PAGE)
        self.assertEqual(honest_directory_problems({
            'cloudhost247-node/frontend/src/pages/domains/ExtensionsPage.tsx': page,
        }), [])

    def test_the_services_still_fail_closed(self) -> None:
        documents = domain_service_documents()
        self.assertEqual(len(documents), 4)
        self.assertEqual(fail_closed_problems(documents), [])

    def test_a_directory_that_stops_explaining_itself_is_reported(self) -> None:
        page = _read(EXTENSIONS_PAGE).replace('none are invented here', 'prices shown are final')
        found = honest_directory_problems({
            'cloudhost247-node/frontend/src/pages/domains/ExtensionsPage.tsx': page,
        })
        self.assertTrue(any('no longer tells the visitor' in item for item in found), found)

    def test_a_service_that_stops_distinguishing_the_unconfigured_state_is_reported(self) -> None:
        documents = domain_service_documents()
        label = 'cloudhost247-node/src/domain-services/search-service.ts'
        documents[label] = documents[label].replace('provider_not_configured', 'completed')
        found = fail_closed_problems(documents)
        self.assertTrue(any(label in item for item in found), found)


if __name__ == '__main__':
    unittest.main()
