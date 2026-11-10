"""CloudHost247 is positioned as a global provider, and still says which law governs it.

Why this exists: on 2026-11-10 the public copy in this repository was moved from Nigeria-first to
global positioning. That is two rules, not one, and a change that honours only one of them is a defect:

* **Copy that describes the company or its services does not name a country as its market.** The
  brand line, the home page, the hub of the Business Tools and the scope sentence of the Fair Usage
  Policy all used to. "Global" and "worldwide" say who CloudHost247 serves; they are never a claim
  about offices or data centres. Data-centre regions still come only from configuration (see
  "Honesty rules" in `shared/site/README.md`).
* **Jurisdictional facts keep their country.** The governing-law clause, the Nigeria Data
  Protection Act references, the .ng dispute procedure and the tools that implement Nigerian
  statutes are not marketing. Removing them would hide where the company answers in law and make
  a payroll calculator lie about whose tax it computes.

Nothing else in the gate could see either rule. A sweep for the word "Nigeria" would have deleted
the second group while fixing the first, and the first group can come back silently: the Fair Usage
Policy text is extracted from `docs/policies/Fair Usage Policy.pdf`, which still carries the earlier
wording until it is re-issued, so re-running `scripts/site/extract-legal-pdf.mjs` restores it.

The register of what was neutralised, what was kept and what is still an open decision is
`docs/BRANDING-COMPATIBILITY.md`, "Global positioning".
"""

from __future__ import annotations

import html
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The country that used to be named as the company's market, its capital, its commercial centre
# and its currency. Deliberately no wider: a region label or another country's name is not this rule.
MARKET = re.compile(r'nigeria|lagos|abuja|\bnaira\b', re.I)

# Surfaces that speak for the whole company. A country name here is positioning by definition:
# none of them carries a legal disclosure, a statutory tool or a location read from configuration.
COMPANY_LEVEL_SURFACES = (
    'cloudhost247-node/frontend/index.html',
    'cloudhost247-node/frontend/src/pages/HomePage.tsx',
    'cloudhost247-node/frontend/src/i18n/site-text.ts',
    'cloudhost247-node/frontend/public/media/cloudhost247/favicon/site.webmanifest',
    'assets/images/cloudhost247/favicon/site.webmanifest',
    'templates/cloudhost247/homepage.tpl',
    'templates/cloudhost247/header.tpl',
    'templates/cloudhost247/aboutus.tpl',
    'faqs.php',
    'aboutus.php',
)

# Every rendering of the Fair Usage Policy: the base text, both theme templates and the two
# generated copies the websites actually serve.
FAIR_USAGE_RENDERINGS = (
    'shared/site/content/legal/fair-usage-policy.txt',
    'templates/cloudhost247/includes/legal/fairusagepolicy.tpl',
    'templates/cloudhost247_legacy/fairusagepolicy.tpl',
    'shared/site/content/legal.generated.json',
    'cloudhost247-node/frontend/src/content/legal.generated.json',
)

STATUTORY_TOOL_SLUGS = (
    'nigeria-paye-net-salary-calculator',
    'nigeria-pension-calculator',
    'nigeria-vat-calculator',
    'nigeria-employer-cost-calculator',
    'hmo-comparison-nigeria',
    'pfa-comparison-nigeria',
)


def text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding='utf-8')


def brand() -> dict:
    return json.loads(text('shared/site/registry.json'))['brand']


def published_policy(slug: str) -> str:
    """The HTML of one policy exactly as both websites publish it."""
    documents = json.loads(text('shared/site/content/legal.generated.json'))['documents']
    matches = [document['html'] for document in documents if document['slug'] == slug]
    if len(matches) != 1:
        raise AssertionError(f'expected exactly one published policy with the slug {slug!r}')
    return matches[0]


class BrandLineTests(unittest.TestCase):
    """The brand block is the company's identity, and every copy of it says the same thing."""

    def test_the_brand_block_is_not_tied_to_a_country(self):
        for key, value in brand().items():
            with self.subTest(key=key):
                self.assertIsNone(
                    MARKET.search(value),
                    f'brand.{key} names a country as the market; CloudHost247 is positioned globally',
                )

    def test_the_brand_block_states_who_the_company_serves(self):
        block = brand()
        self.assertTrue(block.get('descriptor', '').strip(), 'the brand line (brand.descriptor) is missing')
        self.assertIn('Global', block['descriptor'])
        self.assertIn(
            'worldwide', block['description'],
            'the brand description no longer says CloudHost247 serves customers worldwide',
        )

    def test_the_home_page_title_is_the_brand_line(self):
        self.assertIn(
            '`${BRAND.name} — ${BRAND.descriptor}`', text('cloudhost247-node/frontend/src/pages/HomePage.tsx'),
            'the application home page must take its title from the brand registry, not a literal',
        )

    def test_the_static_shell_repeats_the_brand_block_exactly(self):
        """A crawler that runs no JavaScript reads only this file, so it is checked, not trusted."""
        block = brand()
        shell = text('cloudhost247-node/frontend/index.html')
        line = html.escape(f"{block['name']} — {block.get('descriptor', '')}")
        self.assertIn(f'<title>{line}</title>', shell)
        self.assertIn(f'<meta property="og:title" content="{line}" />', shell)
        self.assertIn(f'content="{html.escape(block["description"])}"', shell)

    def test_the_whmcs_home_page_repeats_the_brand_description(self):
        description = brand()['description']
        self.assertNotIn("'", description, 'the description is embedded in a PHP single-quoted string')
        self.assertIn(
            f"'{description}'", text('modules/addons/cloudhost247_theme/lib/Site.php'),
            'the WHMCS home page meta description has drifted from shared/site/registry.json',
        )
        self.assertIn(
            description, text('templates/cloudhost247/homepage.tpl'),
            'the WHMCS home page hero has drifted from shared/site/registry.json',
        )


class PositioningCopyTests(unittest.TestCase):
    """Copy that describes the company or its services names no country as the market."""

    def test_company_level_surfaces_name_no_country(self):
        offenders = []
        for relative in COMPANY_LEVEL_SURFACES:
            for number, line in enumerate(text(relative).splitlines(), start=1):
                match = MARKET.search(line)
                if match:
                    offenders.append(f'{relative}:{number}: {match.group(0)}')
        self.assertEqual(
            offenders, [],
            'These surfaces speak for the whole company and must not present one country as its '
            'market. A jurisdictional fact belongs in the policy or the tool that owns it.',
        )

    def test_the_fair_usage_policy_scope_is_the_same_everywhere(self):
        for relative in FAIR_USAGE_RENDERINGS:
            with self.subTest(rendering=relative):
                rendering = text(relative)
                self.assertNotIn(
                    'across Nigeria', rendering,
                    'The Fair Usage Policy scope reverted to its earlier wording. Re-running '
                    'scripts/site/extract-legal-pdf.mjs does this until the PDF is re-issued; see '
                    '"Amendments to the base text" in shared/site/content/legal/README.md.',
                )
                self.assertIn('and related server resources worldwide.', rendering)

    def test_the_business_tools_hub_is_not_positioned_at_one_country(self):
        catalog = re.search(
            r"slug: 'business-tools',.*?\bsummary:\s*'([^']*)'",
            text('cloudhost247-node/src/tools/catalog.ts'), re.S,
        )
        fallback = re.search(
            r"name: 'Business Tools',\s*summary:\s*'([^']*)'",
            text('cloudhost247-node/src/tools/presentation.ts'),
        )
        self.assertIsNotNone(catalog, 'the Business Tools catalogue entry was not found')
        self.assertIsNotNone(fallback, 'the Business Tools fallback summary was not found')
        for name, summary in (('catalogue', catalog.group(1)), ('fallback', fallback.group(1))):
            with self.subTest(summary=name):
                self.assertIsNone(
                    MARKET.search(summary),
                    'The hub describes the whole suite. Each statutory tool names its own '
                    'jurisdiction; the suite is not for the businesses of one country.',
                )

    def test_the_legacy_home_page_slogan_is_the_brand_line(self):
        """`hometrusbusiness` is the home-page slogan of the legacy theme, kept as a hand copy."""
        overrides = text('lang/overrides/english.php')
        match = re.search(r"\$_LANG\['hometrusbusiness'\]\s*=\s*(['\"])(.*?)\1;", overrides)
        self.assertIsNotNone(match, 'hometrusbusiness is no longer defined')
        self.assertEqual(
            match.group(2), brand().get('descriptor'),
            'the legacy home-page slogan has drifted from brand.descriptor in shared/site/registry.json',
        )


class JurisdictionalDisclosureTests(unittest.TestCase):
    """The other half of the rule: nothing the company must disclose was neutralised."""

    def test_the_governing_law_clause_is_still_published(self):
        clause = 'governed by the laws of the Federal Republic of Nigeria'
        self.assertIn(clause, text('shared/site/content/legal/terms-and-conditions.txt'))
        self.assertIn(clause, published_policy('terms'))
        self.assertIn(
            'Nigerian Courts have exclusive jurisdiction',
            text('templates/cloudhost247_legacy/termsofservice.tpl'),
        )

    def test_the_data_protection_act_references_are_still_published(self):
        notice = text('shared/site/content/legal/data-privacy-notice-and-consent-form.txt')
        for phrase in ('Nigeria Data Protection Act (NDPA) 2023', 'Nigeria Data Protection Commission (NDPC)'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, notice)
        self.assertIn('Nigeria Data Protection Act', published_policy('privacy-notice-and-consent'))
        for template in (
            'templates/cloudhost247/includes/legal/dataprivacynoticeandconsentform.tpl',
            'templates/cloudhost247_legacy/dataprivacynoticeandconsentform.tpl',
        ):
            with self.subTest(template=template):
                self.assertIn('Nigeria Data Protection Act', text(template))
        self.assertIn(
            'published under the Nigeria Data Protection Act 2023', text('shared/site/registry.json'),
            'the legal index must keep naming the statute the notice is published under',
        )

    def test_the_ng_domain_dispute_procedure_is_still_published(self):
        registry = 'Nigeria Internet Registration Association (NIRA)'
        self.assertIn(registry, text('shared/site/content/legal/trademark-and-copyright-infringement-policy.txt'))
        self.assertIn(registry, published_policy('trademark'))
        self.assertIn(registry, text('trademark-policy.php'))

    def test_statutory_tools_still_name_their_jurisdiction(self):
        tools = text('cloudhost247-node/src/tools/business/registry.ts')
        for slug in STATUTORY_TOOL_SLUGS:
            with self.subTest(slug=slug):
                self.assertIn(f"slug: '{slug}'", tools)
        self.assertGreaterEqual(
            text('cloudhost247-node/src/tools/business/calculators.ts').count("jurisdiction: 'Nigeria (federal)'"), 4,
            'a calculator that applies a Nigerian statute must keep saying so beside its result',
        )

    def test_the_naira_is_still_a_supported_currency(self):
        self.assertIn("code: 'NGN'", text('cloudhost247-node/src/currency/registry.ts'))
        self.assertIn("'NGN'", text('cloudhost247-node/frontend/src/components/CurrencySwitcher.tsx'))


if __name__ == '__main__':
    unittest.main()
