#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'modules' / 'addons' / 'digitalproducts'


def assert_true(name, condition):
    print(('PASS' if condition else 'FAIL'), name)
    if not condition:
        raise SystemExit(1)


def read(name):
    return (MODULE / name).read_text()

addons = ROOT / 'modules' / 'addons'
assert_true('no duplicate digital product modules', not any((addons / n).exists() for n in ['digitalproducts_v2', 'downloadmarketplace', 'digitalmarket']))
assert_true('download tokens have a dedicated table', 'mod_digitalproducts_download_tokens' in read('migrations/V100.php'))
assert_true('download tokens are hashed', 'token_hash' in read('lib/Security/TokenService.php') and "hash('sha256'" in read('lib/Security/TokenService.php'))
assert_true('legacy session-only token storage removed', "$_SESSION['dp_download_" not in read('lib/Core.php'))
assert_true('download endpoint uses authorizer', 'authorizeToken' in read('download.php'))
assert_true('admin posts use CSRF/capability guard', 'CapabilityPolicy::requirePost' in read('lib/Admin.php') and 'CapabilityPolicy::tokenField()' in read('lib/Admin.php'))
assert_true('API rejects query-string API token auth', "$_GET['api_token']" not in read('api.php') and 'HTTP_AUTHORIZATION' in read('api.php'))
assert_true('storage abstraction exists', (MODULE / 'lib' / 'Storage' / 'StorageInterface.php').exists())
