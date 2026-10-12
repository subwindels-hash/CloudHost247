"""The platform's copy of the media library must not drift from the library it mirrors.

`cloudhost247-node/frontend/public/media/cloudhost247` is a tracked second copy of
`assets/images/cloudhost247`, because Vite's build empties its public directory. A `<picture>` that
advertises a `-960.avif` which is not there does not fall back — it shows nothing — so the copy has
to be right, and it is refreshed by `scripts/generate-raster-formats.py --emit-served`.

Nothing checked that until now: the ladder was verified but the mirror was not, so adding a scene and
forgetting the sync was invisible until a visitor hit it. `--check` now verifies both sides, and this
module holds the rule to account:

  * the real tree is in sync (the positive case, which is also what the gate runs);
  * a file missing from the mirror is reported;
  * a file whose bytes differ is reported;
  * a stale file the library no longer defines is reported;
  * the library's own notes are not expected in the mirror — the rule mirrors exactly what
    `--emit-served` copies, no more and no less.

The negative cases build small trees and point the script's own constants at them, so the rule is
exercised rather than restated.
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts' / 'generate-raster-formats.py'


def load_script():
    """Import the hyphenated script as a module so its rule can be called directly."""
    spec = importlib.util.spec_from_file_location('ch247_raster_formats', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


SCRIPT_MODULE = load_script()


class MediaLibraryParityTests(unittest.TestCase):
    """Rules that only need the trees on disk."""

    def test_the_real_library_and_served_mirror_are_in_sync(self) -> None:
        missing, differing, extra = SCRIPT_MODULE.served_parity()
        self.assertEqual(missing, [])
        self.assertEqual(differing, [])
        self.assertEqual(extra, [])
        self.assertEqual(SCRIPT_MODULE.parity_problems(), [])

    def test_the_check_mode_verifies_both_sides(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), '--check'],
            capture_output=True, text=True, cwd=ROOT, timeout=300,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('raster ladder complete', result.stdout)
        self.assertIn('served mirror in sync', result.stdout)

    def test_the_library_is_not_empty(self) -> None:
        # An empty library would make every rule above pass for the wrong reason.
        files = [path for path in SCRIPT_MODULE.LIBRARY.rglob('*') if path.is_file()]
        self.assertGreater(len(files), 400)


class MediaLibraryParityNegativeTests(unittest.TestCase):
    """The rule must fail on each way the mirror can drift."""

    def setUp(self) -> None:
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        base = Path(self.root.name)
        self.library = base / 'assets/images/cloudhost247'
        self.served = base / 'cloudhost247-node/frontend/public/media/cloudhost247'
        self.library.mkdir(parents=True)
        self.served.mkdir(parents=True)
        self.saved = (SCRIPT_MODULE.ROOT, SCRIPT_MODULE.LIBRARY, SCRIPT_MODULE.SERVED)
        SCRIPT_MODULE.ROOT, SCRIPT_MODULE.LIBRARY, SCRIPT_MODULE.SERVED = base, self.library, self.served
        self.addCleanup(self.restore_roots)
        (self.library / 'hosting').mkdir()
        (self.library / 'hosting/web-hosting-3d.jpg').write_bytes(b'JPEG')
        (self.library / 'hosting/web-hosting-3d-960.avif').write_bytes(b'AVIF')
        mirror('hosting/web-hosting-3d.jpg', b'JPEG')
        mirror('hosting/web-hosting-3d-960.avif', b'AVIF')

    def restore_roots(self) -> None:
        SCRIPT_MODULE.ROOT, SCRIPT_MODULE.LIBRARY, SCRIPT_MODULE.SERVED = self.saved

    def test_an_in_sync_copy_reports_nothing(self) -> None:
        self.assertEqual(SCRIPT_MODULE.parity_problems(), [])

    def test_a_missing_file_is_reported(self) -> None:
        (self.served / 'hosting/web-hosting-3d-960.avif').unlink()
        problems = SCRIPT_MODULE.parity_problems()
        self.assertTrue(any('missing from the served mirror' in line for line in problems), problems)
        self.assertTrue(any('web-hosting-3d-960.avif' in line for line in problems), problems)

    def test_a_differing_file_is_reported(self) -> None:
        (self.served / 'hosting/web-hosting-3d-960.avif').write_bytes(b'avif')
        problems = SCRIPT_MODULE.parity_problems()
        self.assertTrue(any('differ from the library' in line for line in problems), problems)

    def test_a_stale_file_is_reported(self) -> None:
        (self.served / 'hosting/retired-3d.jpg').write_bytes(b'JPEG')
        problems = SCRIPT_MODULE.parity_problems()
        self.assertTrue(any('stale file' in line for line in problems), problems)
        self.assertTrue(any('retired-3d.jpg' in line for line in problems), problems)

    def test_a_missing_mirror_directory_is_reported(self) -> None:
        shutil.rmtree(self.served)
        problems = SCRIPT_MODULE.parity_problems()
        self.assertTrue(problems, 'a missing mirror must be reported')
        self.assertTrue(any('served mirror' in line or 'media/cloudhost247' in line for line in problems), problems)

    def test_the_library_notes_are_not_expected_in_the_mirror(self) -> None:
        (self.library / 'README.md').write_text('# notes', encoding='utf-8')
        (self.library / 'catalogue-marks.json').write_text('{}', encoding='utf-8')
        self.assertEqual(SCRIPT_MODULE.parity_problems(), [])


def mirror(relative: str, payload: bytes) -> None:
    """Helper used by the fixture: write one file into the temporary mirror."""
    target = SCRIPT_MODULE.SERVED / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)


if __name__ == '__main__':
    unittest.main()
