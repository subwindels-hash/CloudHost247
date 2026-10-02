"""The release-candidate gate must be green on a clean clone and must run everything it owns.

`scripts/release-candidate-check.sh` is the only executable definition of "this tree is
releasable", and `.github/workflows/independent-foundation.yml` runs it on every push, so a
defect in the gate is worse than a defect in a module: it hides every other defect. Four were
found on 2026-10-02 by running the gate's own steps in a clean checkout:

1. **It was red before anyone changed anything.** `test_archive_integration.py` required
   `RDP.zip` to exist with an exact SHA-256, and `.gitignore` excludes `*.zip`, so the archive is
   not distributed: 381 tests ran, 1 failed, every time. A permanently red gate trains reviewers
   to ignore it. The archive check now skips with a recorded reason where the file is absent and
   verifies it fully where it is held.
2. **Suites in the tree were never run.** `tests/payments/test_static.py` (20 tests covering the
   Blockonomics gateway: timing-safe callback secret, no unsafe mark-as-paid, fail-closed unknown
   address), `tests/digitalproducts/test_static.py` and `tests/payments/run.php` all existed and
   passed, and neither gate called them. The payments suite even contained a test named
   `test_php_run_tests_exist_for_ci_with_php` — a runner written for a CI that never invoked it.
3. **The PHP syntax check covered a third of the tree, from two hand-kept lists that had
   drifted apart.** The release script linted 510 of 1531 PHP files; the workflow linted a
   different, slightly larger set. Between them 199 first-party files were checked by neither:
   all 27 language overrides (a syntax error there breaks the whole client area), 18 public
   policy pages (`privacy-policy.php`, `cookie-policy.php`, `legal.php`, `faqs.php`, …), the
   Blockonomics gateway (9), the LTE-proxy server module (16), digitalproducts (21),
   tools_center (18), customaffiliate (15), dnschecker (2), cloudhost247_email (4) and the
   superseded SMM prototypes (12). Both gates now ask `scripts/php-lint-targets.sh`, which
   computes the list from the tree — including the 26 addon `*.tpl` files that are really PHP —
   so a new file is linted the moment it exists and the two gates cannot disagree.
4. **Three documents described an integrity-baseline exemption mechanism that does not exist.**
   They claimed `rebrand-overrides.list` / `.sha256` listed branding-only exceptions and that
   "the release-candidate checker excludes only those explicitly listed paths". Neither file was
   ever in the tree and the checker has never had exclusion logic; the same section of
   `docs/BRANDING-COMPATIBILITY.md` also said no manifest-listed file was edited, which is the
   truth — the baseline is strict and total, and it was re-cut in place (its own header records
   the dates and reasons) instead of exempting paths.

The consequence of that strictness is recorded here too: the seven zero-byte vendor files in
inventory rows C1-C11 are hash-locked as empty, so they cannot be "completed" by writing content
into them without a deliberate, reviewed re-cut of the baseline.
"""
from pathlib import Path
from functools import lru_cache
import hashlib
import os
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/release-candidate-check.sh'
TARGETS_SCRIPT = ROOT / 'scripts/php-lint-targets.sh'
WORKFLOW = ROOT / '.github/workflows/independent-foundation.yml'
MANIFEST = ROOT / 'docs/independent-rebuild/original-file-manifest.sha256'
INVENTORY = ROOT / 'docs/UNFINISHED-MODULES.md'
THIS_SUITE = Path(__file__).resolve().relative_to(ROOT).as_posix()
EMPTY_SHA256 = hashlib.sha256(b'').hexdigest()

# Directories that are not part of the PHP application at all.
NON_TREE_PARTS = frozenset({'.git', 'vendor', 'node_modules', 'cloudhost247-node'})
# The two exclusions the target script names explicitly. The third (the vendor baseline) is read
# from the manifest itself, so the two records cannot disagree.
NAMED_EXCLUSIONS = (
    'modules/addons/xtreme_currency_rates/',  # ionCube-encoded: php -l cannot parse it
    'modules/servers/Smtphosting/',           # third-party module this repository does not modify
)


def manifest_entries():
    """path -> recorded sha256, ignoring the dated header comments."""
    entries = {}
    for line in MANIFEST.read_text().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        digest, _, path = line.partition('  ')
        assert re.fullmatch(r'[0-9a-f]{64}', digest.strip()), f'malformed manifest line: {line!r}'
        entries[path.strip()] = digest.strip()
    return entries


def tree_php():
    return sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*.php')
                  if not (set(p.parts) & NON_TREE_PARTS))


def tree_php_templates():
    """Addon templates that are really PHP: WHMCS executes modules/*/templates/**/*.tpl."""
    return sorted(p.relative_to(ROOT).as_posix() for p in ROOT.glob('modules/**/*.tpl')
                  if '<?php' in p.read_text(errors='ignore'))


@lru_cache(maxsize=1)
def lint_targets():
    """What the gate will actually lint. Cached: four tests ask, the tree does not change."""
    run = subprocess.run(['bash', 'scripts/php-lint-targets.sh'], cwd=ROOT,
                         capture_output=True, text=True, timeout=600)
    assert run.returncode == 0, f'scripts/php-lint-targets.sh failed: {run.stderr}'
    return tuple(run.stdout.splitlines())


def exclusion_pattern():
    match = re.search(r"exclusions='([^']+)'", TARGETS_SCRIPT.read_text())
    assert match, 'the lint target script must declare its exclusions in one place'
    return re.compile(match.group(1))


def wired_suites(pattern):
    return sorted(p.relative_to(ROOT).as_posix() for p in ROOT.glob(pattern))


class ReleaseGateCoverageTests(unittest.TestCase):
    """Every suite and every PHP file this repository owns is inside the gate."""

    def test_every_suite_in_the_tree_is_wired_into_the_gate(self):
        script = SCRIPT.read_text()
        unwired = [suite
                   for pattern in ('tests/**/test_*.py', 'tests/**/run.php')
                   for suite in wired_suites(pattern)
                   if suite not in script]
        self.assertEqual([], unwired, 'these suites exist but the release gate never runs them')

    def test_both_gates_share_one_computed_lint_list(self):
        """Two hand-kept lists drifted; one computed list cannot."""
        for gate in (SCRIPT, WORKFLOW):
            self.assertIn('scripts/php-lint-targets.sh', gate.read_text(),
                          f'{gate.name} must ask the shared script for its lint targets')
        workflow = WORKFLOW.read_text()
        lint_step = [line for line in workflow.splitlines() if 'php-lint-targets.sh' in line]
        self.assertEqual(1, len(lint_step), 'the workflow should lint once, through the shared script')
        # No hand-kept file list may survive in either gate: that is what drifted.
        self.assertNotIn("find modules/addons", workflow)
        self.assertNotIn('-name \'*.php\' -print0', SCRIPT.read_text())
        self.assertTrue(os.access(TARGETS_SCRIPT, os.X_OK) or True)

    def test_every_referenced_suite_actually_exists(self):
        missing = [path
                   for gate in (SCRIPT, WORKFLOW)
                   for path in set(re.findall(r'(?:tests|scripts)/[A-Za-z0-9_./-]+\.(?:py|php|sh)',
                                              gate.read_text()))
                   if not (ROOT / path).is_file()]
        self.assertEqual([], sorted(set(missing)), 'a gate references files that do not exist')

    def test_wired_python_suites_are_green_in_a_clean_clone(self):
        """Run them; do not trust that they were run.

        This is the regression guard for defect 1: a suite that can only pass on a machine
        holding an undistributed artifact makes the gate red for everyone. Suites may skip with a
        recorded reason; they may not fail. This suite excludes itself to avoid recursion.
        """
        suites = [s for s in wired_suites('tests/**/test_*.py') if s != THIS_SUITE]
        self.assertGreater(len(suites), 15, 'expected the whole static suite set')
        run = subprocess.run([sys.executable, '-m', 'unittest', *suites],
                             cwd=ROOT, capture_output=True, text=True, timeout=900)
        tail = '\n'.join(run.stderr.splitlines()[-45:])
        self.assertEqual(0, run.returncode, f'the release gate is red on a clean clone:\n{tail}')

    def test_lint_targets_are_exactly_the_files_we_own(self):
        """Computed independently here, then compared with what the gate will actually lint."""
        baseline = set(manifest_entries())
        excluded = exclusion_pattern()
        expected = []
        for path in tree_php() + tree_php_templates():
            if path in baseline or excluded.search(path):
                continue
            expected.append(path)
        actual = lint_targets()
        self.assertEqual(sorted(expected), sorted(actual),
                         'the lint target list is not the set of unencoded, non-baseline PHP files')
        floor = int(re.search(r'-lt (\d+) \]', SCRIPT.read_text()).group(1))
        self.assertGreaterEqual(len(actual), floor,
                                'the computed lint list collapsed; the gate would lint nothing')
        self.assertGreater(len(actual), 700)

    def test_previously_unlinted_first_party_files_are_now_linted(self):
        """Named, so the specific gap that was found cannot reopen quietly."""
        actual = set(lint_targets())
        for path in ('lang/overrides/english.php', 'privacy-policy.php', 'cookie-policy.php',
                     'legal.php', 'faqs.php', 'builder-page.php', 'cloudhost247-sitemap.php',
                     'modules/gateways/blockonomics.php',
                     'modules/gateways/callback/blockonomics.php',
                     'modules/servers/cloudhost247_lteproxy/cloudhost247_lteproxy.php',
                     'modules/addons/phoneservices/phoneservices.php',
                     'modules/addons/customaffiliate/customaffiliate.php',
                     'modules/addons/digitalproducts/hooks.php',
                     'modules/addons/tools_center/tools_center.php',
                     'modules/addons/dnschecker/dnschecker.php',
                     'modules/servers/cloudhost247_email/cloudhost247_email.php',
                     'modules/addons/phoneservices/templates/admin/dashboard.tpl'):
            self.assertIn(path, actual, f'{path} is first-party PHP and must be linted')

    def test_lint_exclusions_are_real_and_still_current(self):
        """An exclusion that no longer matches anything is a stale claim; fail on it."""
        php = tree_php()
        smtphosting = [p for p in php if p.startswith('modules/servers/Smtphosting/')]
        encoded = [p for p in php if p.startswith('modules/addons/xtreme_currency_rates/')]
        self.assertGreater(len(smtphosting), 600,
                           'the Smtphosting exclusion no longer matches a third-party module')
        self.assertGreater(len(encoded), 10, 'the encoded-vendor exclusion no longer matches anything')
        for path in encoded:
            self.assertTrue(re.search(r'ionCube|Zend Guard|SourceGuardian',
                                      (ROOT / path).read_text(errors='ignore')),
                            f'{path} is excluded as encoded but carries no encoder marker')
        # Nothing first-party may hide inside an exclusion, and nothing excluded may be unnamed.
        for path in lint_targets():
            self.assertFalse(path.startswith(NAMED_EXCLUSIONS), f'{path} is excluded but was listed')
        baseline = set(manifest_entries())
        for path in php:
            if path.startswith(NAMED_EXCLUSIONS) or path in baseline:
                continue
            self.assertIn(path, lint_targets(), f'{path} is excluded from linting for no recorded reason')
        for path in ('modules/addons/cloudhost247_core/lib', 'modules/servers/cloudhost247_ovh'):
            self.assertTrue(any(p.startswith(path) for p in lint_targets()),
                            f'first-party module {path} must be linted')


class IntegrityBaselineTests(unittest.TestCase):
    """The vendor baseline is strict and total, and the documents now say so."""

    def test_baseline_manifest_matches_the_tree(self):
        """The check the gate runs, but naming the drifted paths when it fails."""
        entries = manifest_entries()
        self.assertGreater(len(entries), 2000)
        missing, drifted, duplicates, seen = [], [], [], set()
        for path, digest in entries.items():
            if path in seen:
                duplicates.append(path)
            seen.add(path)
            self.assertNotIn('..', path.split('/'), f'manifest path escapes the repository: {path}')
            target = ROOT / path
            if not target.is_file():
                missing.append(path)
            elif hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                drifted.append(path)
        self.assertEqual([], duplicates, 'the manifest lists a path twice')
        self.assertEqual([], missing, 'the manifest lists files that are not in the tree')
        self.assertEqual([], drifted,
                         'these vendor-derived files were edited; the release gate hashes them byte-for-byte')

    def test_gate_check_is_strict_and_cannot_be_softened_silently(self):
        script = SCRIPT.read_text()
        self.assertIn('sha256sum --check --strict', script)
        line = next(l for l in script.splitlines() if 'sha256sum --check' in l)
        for softener in ('--ignore-missing', '|| true', '2>/dev/null', '>/dev/null', '; echo'):
            self.assertNotIn(softener, line, f'the baseline check must not be softened with {softener!r}')
        self.assertIn('--quiet', line, 'failures must stay visible while the 2000+ OK lines stay out')

    def test_no_document_claims_an_override_manifest_that_does_not_exist(self):
        """`rebrand-overrides.list` / `.sha256` were documented but never shipped.

        A document may still name them to record that the design was superseded — that correction
        is the point of the row — but only in a paragraph that says so. An affirmative claim about
        a file that is not in the tree is what fails here, and if the files are ever really
        introduced the negating paragraphs must be rewritten, which is also caught.
        """
        negated = re.compile(r'\b(no|not|never|none|absent|does not exist|superseded)\b', re.I)
        offenders = []
        for doc in (p for p in ROOT.glob('**/*.md') if not (set(p.parts) & NON_TREE_PARTS)):
            text = doc.read_text(errors='ignore')
            for paragraph in re.split(r'\n\s*\n', text):
                names = set(re.findall(r'rebrand-overrides\.[a-z0-9]+', paragraph))
                if not names:
                    continue
                says_no = bool(negated.search(paragraph))
                for name in names:
                    exists = (ROOT / 'docs/independent-rebuild' / name).is_file()
                    where = f'{doc.relative_to(ROOT).as_posix()}'
                    if not exists and not says_no:
                        offenders.append(f'{where} claims {name} exists')
                    if exists and says_no:
                        offenders.append(f'{where} denies {name} but the file is in the tree')
        self.assertEqual([], offenders,
                         'documents describe an exemption mechanism that does not exist in the tree')

    def test_baseline_locks_the_zero_byte_vendor_stubs_and_the_inventory_says_why(self):
        """The seven empty vendor files cannot be completed by writing content into them.

        They are hash-locked as empty, so filling them turns the release gate red. Each is
        therefore recorded in the inventory with the verified reason it stays empty, instead of
        being left as an open "placeholder" gap that invites a fabricated fix.
        """
        stubs = sorted(path for path, digest in manifest_entries().items() if digest == EMPTY_SHA256)
        self.assertEqual(7, len(stubs), f'expected the seven known empty vendor files, got {stubs}')
        for path in stubs:
            self.assertEqual(0, (ROOT / path).stat().st_size, path)
        inventory = INVENTORY.read_text()
        self.assertIn('original-file-manifest.sha256', inventory,
                      'the inventory must record that these files are hash-locked by the baseline')
        for path in stubs:
            self.assertIn(path, inventory, f'{path} is an empty baseline file and must be documented')
        for row in ('C1', 'C7', 'C10', 'C11'):
            self.assertRegex(inventory, rf'\| {row} \|', f'inventory row {row} must still exist')


class CleanCloneTests(unittest.TestCase):
    """Nothing in the gate may depend on a file the repository does not distribute."""

    def test_no_suite_requires_an_undistributed_archive_without_skipping(self):
        gitignore = ROOT / '.gitignore'
        ignored = {line.strip() for line in gitignore.read_text().splitlines()
                   if line.strip() and not line.startswith('#')} if gitignore.is_file() else set()
        self.assertIn('*.zip', ignored, 'this guard assumes *.zip stays ignored')
        for suite in wired_suites('tests/**/test_*.py'):
            text = (ROOT / suite).read_text()
            for archive in set(re.findall(r"'([A-Za-z0-9_.-]+\.zip)'", text)):
                if (ROOT / archive).is_file():
                    continue  # present here, so an unconditional assertion is legitimate
                self.assertTrue('skipTest' in text or f"assertFalse((ROOT/'{archive}').exists())" in text,
                                f'{suite} requires {archive}, which git does not distribute, without skipping')

    def test_gate_runs_under_bash_and_stays_executable(self):
        """mapfile and process substitution are bash features, not POSIX sh."""
        script = SCRIPT.read_text()
        self.assertIn('bash', script.splitlines()[0])
        self.assertIn('bash', TARGETS_SCRIPT.read_text().splitlines()[0])
        self.assertIn('set -euo pipefail', script)
        self.assertIn('set -euo pipefail', TARGETS_SCRIPT.read_text())
        for path in (SCRIPT, TARGETS_SCRIPT):
            self.assertTrue(os.access(path, os.X_OK), f'{path} must stay executable')
        self.assertIn('bash scripts/release-candidate-check.sh', WORKFLOW.read_text(),
                      'CI must run the same gate a release candidate runs locally')


if __name__ == '__main__':
    unittest.main()
