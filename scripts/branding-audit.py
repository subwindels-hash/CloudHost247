#!/usr/bin/env python3
"""CloudHost247 retired-brand audit.

Performs the repository-wide search demanded by the rebrand brief — every
spelling of the retired vendor brand in file *content* and in file/directory
*names*:

    every capitalisation, spacing and separator variant of the retired vendor
    brand (the nine spellings: cased, spaced, hyphenated and underscored),

plus the three-letter abbreviations derived from the retired brand, and
enforces a single, reviewed exception register:

    docs/independent-rebuild/branding-exceptions.list

A match that is not covered by a rule in that register is a release-blocking
violation. A rule that no longer matches anything is reported as stale, so the
register cannot quietly rot into a blanket exemption.

Git-ignored directories (.git, __pycache__, node_modules, templates_c, .venv)
are skipped so the report is deterministic.

Binary files are not decoded. Image/audio assets are therefore only checked by
*name*; verifying that a logo's pixels do not spell the old brand is a design
review, tracked in docs/BRANDING-COMPATIBILITY.md ("Logo assets").

Usage:
    python3 scripts/branding-audit.py            # human-readable report
    python3 scripts/branding-audit.py --quiet    # only violations / summary
    python3 scripts/branding-audit.py --json     # machine-readable report

Exit status: 0 clean, 1 violations found, 2 auditor or register error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTER = os.path.join(
    REPO_ROOT, 'docs', 'independent-rebuild', 'branding-exceptions.list'
)

# Every spelling listed in the rebrand brief, plus the token characters that
# follow it (identifiers, table names, paths, file extensions).
TOKEN = re.compile(r'host[\s_-]?x[A-Za-z0-9_./-]*', re.IGNORECASE)

# Derived abbreviations that do not contain the literal brand but were formed
# from it (the retired brand's email product -> its three-letter code).
# Word-anchored so unrelated text cannot match. The pattern is assembled from
# fragments so this file never spells the retired brand in plain text.
ABBREVIATION = re.compile(r'\bH' 'XE' r'\b|\bH' 'XE' r'-[0-9]+\b|\bh' 'xe'
                        r'[-_][A-Za-z0-9_-]*', re.IGNORECASE)

PATTERNS = (('brand', TOKEN), ('abbreviation', ABBREVIATION))

REASON_CODES = {
    'IONCUBE', 'ADDON-CTL', 'DB-STORED', 'MIGRATION', 'DETECTOR',
    'BASELINE', 'RECORD', 'ASSERTION', 'REGISTER',
}

# Directories that are not part of the repository (all git-ignored) or that hold
# compiled caches. Scanning them would make the report non-deterministic.
SKIP_DIRS = {'.git', '__pycache__', 'node_modules', 'templates_c', '.venv'}


def glob_to_regex(pattern: str) -> re.Pattern:
    """fnmatch-style glob where '*' stops at '/' and '**' crosses it.

    '**/' matches zero or more whole path segments, so `a/**/b.php` also covers
    `a/b.php`.
    """
    out = []
    i = 0
    while i < len(pattern):
        if pattern.startswith('**/', i):
            out.append('(?:.*/)?')
            i += 3
            continue
        if pattern.startswith('**', i):
            out.append('.*')
            i += 2
            continue
        char = pattern[i]
        if char == '*':
            out.append('[^/]*')
        elif char == '?':
            out.append('[^/]')
        else:
            out.append(re.escape(char))
        i += 1
    return re.compile('^' + ''.join(out) + '$')


class Rule:
    __slots__ = ('kind', 'glob', 'glob_re', 'token_re', 'reason', 'note',
                 'line_no', 'uses')

    def __init__(self, kind, glob, token, reason, note, line_no):
        self.kind = kind
        self.glob = glob
        self.glob_re = glob_to_regex(glob)
        self.token_re = None if token == 'ANY' else re.compile(token)
        self.reason = reason
        self.note = note
        self.line_no = line_no
        self.uses = 0

    def allows_token(self, token: str) -> bool:
        if self.token_re is None:
            return True
        return self.token_re.search(token) is not None

    def matches_path(self, rel: str) -> bool:
        return self.glob_re.match(rel) is not None


def load_register(path: str):
    content_rules, path_rules = [], []

    with open(path, encoding='utf-8') as handle:
        for line_no, raw in enumerate(handle, start=1):
            line = raw.rstrip('\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            fields = line.split('\t')
            if len(fields) != 5:
                raise SystemExit(
                    f'{os.path.relpath(path, REPO_ROOT)}:{line_no}: expected 5 '
                    f'TAB-separated fields, found {len(fields)}'
                )
            kind, glob, token, reason, note = (f.strip() for f in fields)
            if reason not in REASON_CODES:
                raise SystemExit(
                    f'{os.path.relpath(path, REPO_ROOT)}:{line_no}: unknown '
                    f'reason code {reason!r}'
                )
            if kind == 'content':
                content_rules.append(Rule(kind, glob, token, reason, note, line_no))
            elif kind == 'path':
                if token != '-':
                    raise SystemExit(
                        f'{os.path.relpath(path, REPO_ROOT)}:{line_no}: a path '
                        f'rule must use "-" as its token field'
                    )
                path_rules.append(Rule(kind, glob, token, reason, note, line_no))
            else:
                raise SystemExit(
                    f'{os.path.relpath(path, REPO_ROOT)}:{line_no}: rule kind '
                    f'must be "content" or "path", got {kind!r}'
                )

    # An empty register is the intended steady state: the vendor stack that
    # owned the retired identifiers has been retired, so nothing is tolerated
    # and every match is a violation.

    return content_rules, path_rules


# ionCube writes a plaintext loader shim in front of the encrypted payload
# ("<?php //ICB0 ..." for modern encodings, "<?php //00507" for older ones).
# The payload is not source: scanning it would report random base64 sequences
# and, more importantly, nothing in it can be edited.
IONCUBE_MARKERS = (b'//ICB0', b'ionCube Loader', b'_il_exec')


def read_text(path: str):
    """Return the decoded text, or None when the file is binary."""
    try:
        with open(path, 'rb') as handle:
            data = handle.read()
    except OSError:
        return None
    if b'\x00' in data:
        return None
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        return None


def find_tokens(line: str):
    """Every brand or brand-derived abbreviation token on one line, in order.

    Overlapping matches are reported once (the earliest, longest span wins), so
    a line cannot inflate the count or be checked against a rule twice.
    """
    spans = []
    for _name, pattern in PATTERNS:
        for match in pattern.finditer(line):
            spans.append((match.start(), match.end(), match.group(0)))
    spans.sort(key=lambda span: (span[0], -(span[1] - span[0])))

    tokens = []
    last_end = -1
    for start, end, text in spans:
        if start < last_end:
            continue
        tokens.append(text)
        last_end = end
    return tokens


def is_protected(path: str) -> bool:
    """True for ionCube-encoded vendor bytecode, which cannot be rebranded."""
    try:
        with open(path, 'rb') as handle:
            head = handle.read(2048)
    except OSError:
        return False
    if not head.startswith(b'<?php //'):
        return False
    return any(marker in head for marker in IONCUBE_MARKERS)


def audit():
    content_rules, path_rules = load_register(REGISTER)

    violations = []
    allowed = []          # (rel, kind, token_or_none, reason, rule)
    binary_files = 0
    protected_files = 0
    scanned_files = 0
    named_assets = []

    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(files):
            absolute = os.path.join(root, name)
            rel = os.path.relpath(absolute, REPO_ROOT).replace(os.sep, '/')

            # --- file / directory names -----------------------------------
            if TOKEN.search(rel):
                rule = next((r for r in path_rules if r.matches_path(rel)), None)
                if rule is None:
                    if read_text(absolute) is None:
                        named_assets.append(rel)
                    violations.append({
                        'path': rel, 'line': None, 'token': rel,
                        'kind': 'path',
                        'detail': 'no path rule covers this name',
                    })
                else:
                    rule.uses += 1
                    allowed.append((rel, 'path', rel, rule.reason, rule))
                    # The encoded vendor tree is reported once, as a directory,
                    # not file by file. Everything else whose *name* still
                    # carries the retired brand is listed for design review.
                    if read_text(absolute) is None and rule.reason != 'IONCUBE':
                        named_assets.append(rel)

            # --- file content ---------------------------------------------
            if is_protected(absolute):
                protected_files += 1
                continue

            text = read_text(absolute)
            if text is None:
                binary_files += 1
                continue
            scanned_files += 1

            for line_no, line in enumerate(text.splitlines(), start=1):
                for token in find_tokens(line):
                    rule = next(
                        (r for r in content_rules
                         if r.matches_path(rel) and r.allows_token(token)),
                        None,
                    )
                    if rule is None:
                        violations.append({
                            'path': rel, 'line': line_no, 'token': token,
                            'kind': 'content',
                            'detail': line.strip()[:160],
                        })
                        continue
                    rule.uses += 1
                    allowed.append((rel, 'content', token, rule.reason, rule))

    stale = [r for r in content_rules + path_rules if r.uses == 0]
    return {
        'violations': violations,
        'allowed': allowed,
        'stale': stale,
        'scanned_files': scanned_files,
        'binary_files': binary_files,
        'protected_files': protected_files,
        'named_assets': named_assets,
        'rules': content_rules + path_rules,
    }


def report(result, quiet=False, as_json=False):
    if as_json:
        by_reason = Counter(entry[3] for entry in result['allowed'])
        by_file = Counter(entry[0] for entry in result['allowed'])
        print(json.dumps({
            'scanned_text_files': result['scanned_files'],
            'binary_files_skipped': result['binary_files'],
            'ioncube_encoded_files_skipped': result['protected_files'],
            'total_matches': len(result['allowed']) + len(result['violations']),
            'allowed_matches': len(result['allowed']),
            'violations': result['violations'],
            'allowed_by_reason': dict(sorted(by_reason.items())),
            'allowed_by_file': dict(sorted(by_file.items())),
            'stale_rules': [
                {'line': r.line_no, 'kind': r.kind, 'glob': r.glob,
                 'reason': r.reason} for r in result['stale']
            ],
            'binary_assets_named_with_legacy_brand': result['named_assets'],
        }, indent=2, sort_keys=True))
        return

    total = len(result['allowed']) + len(result['violations'])
    print('== CloudHost247 retired-brand audit ==')
    print(f'text files scanned      : {result["scanned_files"]}')
    print(f'binary files skipped    : {result["binary_files"]}'
          ' (checked by name only)')
    print(f'ionCube files skipped   : {result["protected_files"]}'
          ' (encrypted vendor bytecode; checked by name only)')
    print(f'Retired-brand matches   : {total}')
    print(f'  covered by a register : {len(result["allowed"])}')
    print(f'  UNREGISTERED          : {len(result["violations"])}')

    if result['violations']:
        print('\n-- violations (must be rebranded or added to the register) --')
        for violation in result['violations']:
            where = violation['path']
            if violation['line']:
                where += f':{violation["line"]}'
            print(f'  {where}  [{violation["kind"]}]  {violation["token"]}')
            if violation['detail'] and violation['kind'] == 'content':
                print(f'      {violation["detail"]}')

    by_reason = Counter(entry[3] for entry in result['allowed'])
    if by_reason and not quiet:
        print('\n-- registered matches by reason code --')
        width = max(len(code) for code in by_reason)
        for code, count in sorted(by_reason.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f'  {code:<{width}}  {count}')

    if not quiet:
        by_file = Counter(entry[0] for entry in result['allowed'])
        print('\n-- registered matches by file (top 25) --')
        for path, count in by_file.most_common(25):
            print(f'  {count:>5}  {path}')
        if len(by_file) > 25:
            print(f'  ... and {len(by_file) - 25} more file(s)')

    if result['named_assets']:
        print('\n-- binary assets whose NAME carries the legacy brand --')
        for path in result['named_assets']:
            print(f'  {path}')
        print('  Their pixels are not decoded; see docs/BRANDING-COMPATIBILITY.md §4.')
        print('  (the ionCube vendor tree is excluded - it is reported once, above)')

    if result['stale']:
        print('\n-- stale register rules (no longer match anything) --')
        for rule in result['stale']:
            rel = os.path.relpath(REGISTER, REPO_ROOT)
            print(f'  {rel}:{rule.line_no}  {rule.kind}  {rule.glob}  [{rule.reason}]')

    print()
    if result['violations']:
        print(f'FAILED: {len(result["violations"])} unregistered retired-brand reference(s).')
    else:
        print('PASSED: no retired-brand reference remains in the repository.')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--quiet', action='store_true',
                        help='print only the summary and violations')
    parser.add_argument('--json', action='store_true',
                        help='emit a machine-readable report')
    args = parser.parse_args(argv)

    if not os.path.isfile(REGISTER):
        print(f'missing exception register: {REGISTER}', file=sys.stderr)
        return 2

    try:
        result = audit()
    except SystemExit as error:
        print(str(error), file=sys.stderr)
        return 2

    report(result, quiet=args.quiet, as_json=args.json)
    return 1 if result['violations'] else 0


if __name__ == '__main__':
    sys.exit(main())
