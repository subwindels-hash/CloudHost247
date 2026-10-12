"""The catalogues must stay honest: they may list software without implying it is deployable.

The applications directory and the operating-system families are the places where a hosting site
most naturally over-claims. The requirement is explicit — a catalogue entry is not evidence of
operational support, availability comes from the backend, and nothing may be presented as
provisionable when the platform has not verified it.

The pages in fact say all of that. Nothing enforced it, so any future copy edit could soften the
wording and the acceptance criteria could only describe the situation as partial. This module turns
those sentences into rules, at three levels:

* **source** — `templates/cloudhost247/cloudhost247-platform.tpl` must carry the required wording, the
  live-catalogue hooks, and none of the phrases that promise a workflow.
* **repository** — no first-party public page or active theme template may promise a workflow either.
  This runs in the release gate, where no rendered fixtures exist.
* **rendered** — when a fixture tree is available (`CH247_FIXTURE_DIR`), the same rules are applied to
  the pages as a visitor receives them, plus "no catalogue page shows a price".

Every level has negative cases that mutate a copy and require each rule to fire: a check that cannot
fail is not a check. The rules live in `source_problems()`, `promise_problems()` and
`fixture_problems()` so the positive and negative cases exercise the same code.
"""

from __future__ import annotations

import html
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_TEMPLATE = ROOT / 'templates' / 'cloudhost247' / 'cloudhost247-platform.tpl'

FIXTURE_PAGES = ('applications.php', 'operating-systems.php')

# The sentences that make each catalogue honest. The first two stop the manifest list reading as an
# offer; the next three make the operating-system families a catalogue rather than a stock list.
PAGE_SENTENCES = {
    'applications.php': (
        'not a claim of deployment availability',
        'Manifest available. Confirm eligibility with the live platform before deployment.',
    ),
    'operating-systems.php': (
        'These names are catalogue families',
        'A family is available only when the connected platform returns it',
        'This list is not stock',
    ),
}
REQUIRED_SENTENCES = tuple(
    sentence for sentences in PAGE_SENTENCES.values() for sentence in sentences
)

# Availability is read from the connected platform. Without these hooks a page could only be showing
# authored content, which is exactly the claim the copy says it is not making.
#
# The template writes the catalogue kind through Smarty (`{if ...}os{else}apps{/if}`), so the source
# check looks for the attributes as attributes and the rendered check looks for the resolved values.
REQUIRED_SOURCE_HOOKS = ('data-ch-catalog', 'data-catalog-status', 'data-catalog-results')

# Phrases that promise a workflow rather than describing a catalogue. None of them describes what the
# backend can prove for a reader who has not chosen a service, a region and a version.
FORBIDDEN_PROMISES = (
    'instant deploy',
    'one-click install',
    'deploy now',
    'available now',
    'in stock',
)

# A currency-formatted number. Prices come from WHMCS; one authored into a catalogue page is a
# fabricated price.
AMOUNT = re.compile(r'(?:[$£€₦]\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|GBP|NGN))')

# Where the repository-wide promise sweep looks. Legacy templates are out of scope: they are kept
# only as byte-compatibility evidence and are not served.
SWEEP_GLOBS = ('*.php', 'templates/cloudhost247/**/*.tpl', 'templates/cloudhost247/*.tpl')
SWEEP_SKIP = ('templates/cloudhost247_legacy/',)


def source_problems(text: str, label: str = 'cloudhost247-platform.tpl') -> list[str]:
    """Rules decidable from the platform template alone (source level)."""
    found: list[str] = []
    for sentence in REQUIRED_SENTENCES:
        if sentence not in text:
            found.append(f'{label} no longer states: {sentence!r}')
    for hook in REQUIRED_SOURCE_HOOKS:
        if re.search(rf'{re.escape(hook)}(?![\w-])', text) is None:
            found.append(f'{label} no longer carries the live-catalogue hook {hook}')
    found.extend(promise_problems({label: text}))
    return found


def promise_problems(documents: dict[str, str]) -> list[str]:
    """Report any phrase that promises a workflow the backend has not verified on this reader.

    Deliberately a phrase list and not a heuristic: "stock" alone appears in ordinary prose about the
    upstream theme, and a rule that flags that would be noise, not a guard.
    """
    found: list[str] = []
    for label, text in documents.items():
        lower = text.lower()
        for phrase in FORBIDDEN_PROMISES:
            if phrase in lower:
                found.append(f'{label} promises "{phrase}", which the backend has not verified')
    return found


def sweep_documents() -> dict[str, str]:
    """Every first-party public page and active theme template, keyed by repository path."""
    paths: list[Path] = []
    for pattern in SWEEP_GLOBS:
        paths.extend(sorted(ROOT.glob(pattern)))
    documents = {}
    for path in paths:
        relative = path.relative_to(ROOT).as_posix()
        if any(relative.startswith(skip) for skip in SWEEP_SKIP) or not path.is_file():
            continue
        documents[relative] = path.read_text(encoding='utf-8', errors='ignore')
    return documents


def rendered_text(root: Path, page: str) -> str:
    """Visible text of a rendered fixture, with tags and entities resolved."""
    raw = (root / f'{page}.html').read_text(encoding='utf-8')
    without_scripts = re.sub(r'<(script|style)\b.*?</\1>', ' ', raw, flags=re.S | re.I)
    text = re.sub(r'<[^>]+>', ' ', without_scripts)
    return re.sub(r'\s+', ' ', html.unescape(text))


def fixture_problems(root: Path, page: str) -> list[str]:
    """Everything wrong with the page a visitor actually receives (empty list means clean)."""
    markup = (root / f'{page}.html').read_text(encoding='utf-8')
    text = rendered_text(root, page)
    found: list[str] = []

    for sentence in PAGE_SENTENCES[page]:
        if sentence not in text:
            found.append(f'{page} renders without the sentence: {sentence!r}')

    # The resolved catalogue kind this page must carry, plus the two regions the live read fills.
    # The attribute must be a token: `data-catalog-status--removed` is not the hook.
    expected_kind = 'os' if page == 'operating-systems.php' else 'apps'
    hooks = (f'data-ch-catalog="{expected_kind}"', 'data-catalog-status', 'data-catalog-results')
    for hook in hooks:
        if re.search(rf'{re.escape(hook)}(?![-\\w])', markup) is None:
            found.append(f'{page} renders without the live-catalogue hook {hook}')

    amounts = AMOUNT.findall(text)
    if amounts:
        found.append(f'{page} renders a price ({amounts[:3]}); pricing comes from WHMCS')

    found.extend(promise_problems({page: text}))
    return found


def fixture_root() -> Path | None:
    """The fixture tree, only when it actually holds the pages this module checks."""
    configured = os.environ.get('CH247_FIXTURE_DIR', '').strip()
    root = Path(configured) if configured else Path('/tmp/ch247-fixtures')
    if all((root / f'{page}.html').is_file() for page in FIXTURE_PAGES):
        return root
    return None


FIXTURES = fixture_root()
NO_FIXTURES = 'rendered fixtures not available; set CH247_FIXTURE_DIR to a rendered fixture tree'


class CatalogueSourceTests(unittest.TestCase):
    """The template the two catalogue pages render through."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.text = PLATFORM_TEMPLATE.read_text(encoding='utf-8')

    def test_the_source_carries_the_required_wording_and_hooks(self) -> None:
        self.assertEqual(source_problems(self.text), [])

    def test_each_required_sentence_is_actually_reachable(self) -> None:
        # A rule on a sentence that Smarty never emits is decoration. Both catalogue pages come from
        # this one template, so every required sentence must be present in it.
        for sentence in REQUIRED_SENTENCES:
            self.assertIn(sentence, self.text)

    def test_the_template_says_the_operating_system_list_is_not_stock(self) -> None:
        self.assertIn('This list is not stock', self.text)


class CatalogueSourceNegativeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = PLATFORM_TEMPLATE.read_text(encoding='utf-8')

    def test_softening_a_required_sentence_is_reported(self) -> None:
        weakened = self.text.replace('not a claim of deployment availability', 'the definitive catalogue')
        found = source_problems(weakened)
        self.assertTrue(any('no longer states' in item for item in found), found)

    def test_removing_the_per_card_note_is_reported(self) -> None:
        weakened = self.text.replace(
            'Manifest available. Confirm eligibility with the live platform before deployment.',
            'Ready to deploy.',
        )
        found = source_problems(weakened)
        self.assertTrue(any('no longer states' in item for item in found), found)

    def test_dropping_a_live_catalogue_hook_is_reported(self) -> None:
        weakened = self.text.replace('data-ch-catalog=', 'data-ch-catalog-removed=')
        found = source_problems(weakened)
        self.assertTrue(any('data-ch-catalog' in item for item in found), found)

    def test_dropping_the_status_region_is_reported(self) -> None:
        weakened = self.text.replace('data-catalog-status', 'data-catalog-state')
        found = source_problems(weakened)
        self.assertTrue(any('data-catalog-status' in item for item in found), found)

    def test_a_promised_workflow_in_the_source_is_reported(self) -> None:
        weakened = self.text.replace('This list is not stock', 'This list is not stock. Available now')
        found = source_problems(weakened)
        self.assertTrue(any('available now' in item for item in found), found)


class CataloguePromiseSweepTests(unittest.TestCase):
    """No first-party public page promises provisioning the backend has not verified."""

    def test_no_first_party_page_promises_a_workflow(self) -> None:
        documents = sweep_documents()
        self.assertGreater(len(documents), 40, 'the sweep found suspiciously few documents')
        self.assertEqual(promise_problems(documents), [])

    def test_the_sweep_covers_the_public_pages_and_the_active_theme(self) -> None:
        documents = sweep_documents()
        self.assertIn('applications.php', documents)
        self.assertIn('operating-systems.php', documents)
        self.assertIn('templates/cloudhost247/cloudhost247-platform.tpl', documents)
        self.assertFalse([path for path in documents if 'cloudhost247_legacy/' in path])

    def test_the_sweep_reports_a_promise_in_a_copy_of_a_page(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            page = Path(directory) / 'applications.php'
            page.write_text('<p>Instant deploy, one click and it is live.</p>', encoding='utf-8')
            found = promise_problems({page.name: page.read_text(encoding='utf-8')})
        self.assertTrue(any('instant deploy' in item for item in found), found)

    def test_the_sweep_reports_a_stock_claim(self) -> None:
        found = promise_problems({'page.html': '<p>Operating systems in stock today.</p>'})
        self.assertTrue(any('in stock' in item for item in found), found)

    def test_negated_stock_wording_is_not_flagged(self) -> None:
        # The catalogue pages say "This list is not stock"; the rule must not fire on the disclaimer.
        self.assertEqual(promise_problems({'page.html': '<p>This list is not stock.</p>'}), [])


@unittest.skipUnless(FIXTURES is not None, NO_FIXTURES)
class CatalogueFixtureTests(unittest.TestCase):
    def test_the_catalogue_pages_state_what_they_are(self) -> None:
        for page in FIXTURE_PAGES:
            self.assertEqual(fixture_problems(FIXTURES, page), [], f'{page} breaks a catalogue honesty rule')

    def test_the_application_directory_names_itself_a_catalogue_and_not_an_offer(self) -> None:
        text = rendered_text(FIXTURES, 'applications.php')
        self.assertIn('not a claim of deployment availability', text)
        self.assertIn(
            'Manifest available. Confirm eligibility with the live platform before deployment.',
            text,
        )

    def test_the_operating_system_families_are_labelled_as_catalogue_names(self) -> None:
        text = rendered_text(FIXTURES, 'operating-systems.php')
        self.assertIn('These names are catalogue families', text)
        self.assertIn('A family is available only when the connected platform returns it', text)
        self.assertIn('This list is not stock', text)


@unittest.skipUnless(FIXTURES is not None, NO_FIXTURES)
class CatalogueFixtureNegativeTests(unittest.TestCase):
    """Each rendered-page rule must fail on the thing it guards, or it is decoration."""

    def setUp(self) -> None:
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(shutil.rmtree, self.root.name, ignore_errors=True)
        self.directory = Path(self.root.name)
        for page in FIXTURE_PAGES:
            shutil.copy(FIXTURES / f'{page}.html', self.directory / f'{page}.html')

    def rewrite(self, page: str, old: str, new: str) -> None:
        path = self.directory / f'{page}.html'
        text = path.read_text(encoding='utf-8')
        self.assertIn(old, text, f'the mutation target is gone from {page}: {old!r}')
        path.write_text(text.replace(old, new))

    def test_a_fabricated_price_is_reported(self) -> None:
        self.rewrite('operating-systems.php', 'This list is not stock.', 'This list is not stock. From $49/mo.')
        found = fixture_problems(self.directory, 'operating-systems.php')
        self.assertTrue(any('renders a price' in item for item in found), found)

    def test_a_promised_workflow_is_reported(self) -> None:
        self.rewrite(
            'applications.php',
            'Explore the manifest catalogue.',
            'Explore the manifest catalogue. Available now.',
        )
        found = fixture_problems(self.directory, 'applications.php')
        self.assertTrue(any('available now' in item for item in found), found)

    def test_a_softened_disclaimer_is_reported_in_the_rendered_page(self) -> None:
        self.rewrite('applications.php', 'not a claim of deployment availability', 'the definitive catalogue')
        found = fixture_problems(self.directory, 'applications.php')
        self.assertTrue(any('renders without the sentence' in item for item in found), found)

    def test_dropping_the_live_catalogue_kind_is_reported_in_the_rendered_page(self) -> None:
        self.rewrite('operating-systems.php', 'data-ch-catalog="os"', 'data-ch-catalog="catalogue"')
        found = fixture_problems(self.directory, 'operating-systems.php')
        self.assertTrue(any('data-ch-catalog="os"' in item for item in found), found)

    def test_the_untouched_copy_reports_nothing(self) -> None:
        for page in FIXTURE_PAGES:
            self.assertEqual(fixture_problems(self.directory, page), [])


if __name__ == '__main__':
    unittest.main()
