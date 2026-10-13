"""The release workflow and acceptance criteria are executable claims, so check them.

`docs/RELEASE-WORKFLOW.md` names the commands a release actually runs, and
`docs/ACCEPTANCE-CRITERIA.md` states which criteria are verified and by what. Both are the kind of
document that rots silently: a renamed script or a deleted step leaves prose that reads perfectly and
tells an operator to run something that does not exist — discovered at the worst possible moment, on
a staging host, mid-release.

So the documents are treated as claims and checked as claims:

  * the workflow has exactly thirteen steps, numbered, in order, and the last one is the explicit
    production-approval gate — the property that makes the workflow staging-only;
  * the workflow does not claim to deploy to production (it may say it does not, and must say so in
    the step that ends it);
  * every repository path the workflow names — scripts, test harnesses, documents — exists;
  * the acceptance criteria use only the four defined status words, so "done" cannot be softened
    into prose, and every criterion names a deciding command or an explicit prerequisite.

These run in the same suite as the rest of the security/static checks, with no PHP and no network.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / 'docs' / 'RELEASE-WORKFLOW.md'
CRITERIA = ROOT / 'docs' / 'ACCEPTANCE-CRITERIA.md'

# Paths the documents name as runnable things. Matched textually and then resolved, so a renamed
# script fails here rather than on the staging host.
COMMAND_PATTERN = re.compile(
    r'(?<![\w./-])('
    r'(?:scripts|tests|docs)/[\w./-]+\.(?:json|mjs|cjs|py|php|sh|md|js|txt)'
    r')'
)
STATUS_WORDS = ('COMPLETE', 'PARTIAL', 'BLOCKED', 'NOT TESTED')


class ReleaseWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = WORKFLOW.read_text(encoding='utf-8')

    def test_the_workflow_has_exactly_thirteen_numbered_steps_in_order(self) -> None:
        steps = re.findall(r'^## (\d+)\. ', self.text, re.M)
        self.assertEqual(
            [int(step) for step in steps],
            list(range(1, 14)),
            'the release workflow must be thirteen numbered steps in order',
        )

    def test_the_last_step_is_the_explicit_production_approval_gate(self) -> None:
        body = self.text.split('## 13.', 1)
        self.assertEqual(len(body), 2, 'there is no step 13')
        tail = body[1]
        for required in ('production approval', 'approval'):
            self.assertIn(required, tail.lower())
        self.assertIn('Nothing above deploys to production', tail)
        # The gate is a human decision with a record; the document must say what that record holds.
        for required in ('approver', 'commit SHA', 'rollback'):
            self.assertIn(required, tail)

    def test_the_workflow_declares_itself_staging_only(self) -> None:
        self.assertIn('staging only', self.text.lower())
        self.assertIn(
            'Nothing in this\nrepository deploys to production',
            self.text,
            'the workflow must say, up front, that it performs no production action',
        )

    def test_every_repository_path_the_workflow_names_exists(self) -> None:
        named = sorted(set(COMMAND_PATTERN.findall(self.text)))
        self.assertGreaterEqual(
            len(named), 15, f'this check is only meaningful when the document names commands; found {named}'
        )
        missing = [path for path in named if not (ROOT / path).exists()]
        self.assertEqual(missing, [], f'the workflow names paths that do not exist: {missing}')

    def test_steps_that_touch_staging_are_labelled_staging_host(self) -> None:
        # The marker is what stops an operator running a WHMCS-touching step against a checkout. It
        # must appear on the steps that need the real installation, and not on the source-only ones.
        numbered = re.split(r'^## \d+\. ', self.text, flags=re.M)[1:]
        source_only = [0, 4]  # steps 1 and 5: gate, and the archive build
        for index, body in enumerate(numbered):
            if index in source_only:
                self.assertNotIn('*staging host.*', body, f'step {index + 1} is source-only')
            elif index in (1, 2, 3, 6, 7, 8, 9, 10, 11):
                self.assertIn('*staging host.*', body, f'step {index + 1} needs the staging marker')


class AcceptanceCriteriaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = CRITERIA.read_text(encoding='utf-8')

    def test_only_the_four_defined_status_words_are_used(self) -> None:
        for word in STATUS_WORDS:
            self.assertIn(f'**{word}**', self.text, f'the status vocabulary must define {word}')
        # Every row in a status table ends with one of the vocabulary words in bold. Rows that end
        # in anything else are how a criterion quietly becomes "probably fine".
        rows = [line for line in self.text.splitlines() if line.startswith('| ') and line.count('|') >= 4]
        decided = [
            row for row in rows
            if not set(row.split('|')[1].strip()) <= set('-# ') and 'Decided by' not in row
        ]
        offenders = []
        for row in decided:
            cells = [cell.strip() for cell in row.strip('|').split('|')]
            if len(cells) < 4 or cells[0] in ('#', 'Step'):
                continue
            if not any(cells[-1].startswith(f'**{word}**') for word in STATUS_WORDS):
                offenders.append(cells[0])
        self.assertEqual(offenders, [], f'criteria without a status word: {offenders}')

    def test_every_criterion_names_a_deciding_command_or_a_prerequisite(self) -> None:
        rows = [
            line for line in self.text.splitlines()
            if line.startswith('| ') and re.match(r'\| [A-E]\d ', line)
        ]
        self.assertGreaterEqual(len(rows), 20, 'the criteria table looks truncated')
        for row in rows:
            cells = [cell.strip() for cell in row.strip('|').split('|')]
            self.assertGreaterEqual(len(cells), 4, row)
            decided = cells[2]
            self.assertTrue(
                decided and (decided.startswith('`') or '`' in decided),
                f'criterion {cells[0]} does not name a command: {decided!r}',
            )

    def test_the_blocked_criteria_name_their_prerequisite(self) -> None:
        rows = [
            line for line in self.text.splitlines()
            if '**BLOCKED**' in line and re.match(r'\| [A-E]\d ', line)
        ]
        self.assertGreaterEqual(len(rows), 1, 'the staging-only work should still be listed as blocked')
        for row in rows:
            self.assertTrue(
                'licensed' in row or 'staging' in row.lower(),
                f'a blocked criterion must say what it is blocked on: {row}',
            )

    def test_the_document_points_at_the_release_workflow_and_the_audit(self) -> None:
        for link in ('RELEASE-WORKFLOW.md', 'website-rebuild/AUDIT-AND-READINESS-2026-10-12.md'):
            self.assertIn(link, self.text)
            target = (CRITERIA.parent / link).resolve()
            self.assertTrue(target.is_file(), f'{link} does not resolve')


if __name__ == '__main__':
    unittest.main()
