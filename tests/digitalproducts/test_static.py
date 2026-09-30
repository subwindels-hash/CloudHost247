from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'modules' / 'addons' / 'digitalproducts'


def read(name):
    return (MODULE / name).read_text()


def test_no_duplicate_digitalproducts_module_created():
    addons = ROOT / 'modules' / 'addons'
    duplicates = [p.name for p in addons.iterdir() if p.is_dir() and p.name in {'digitalproducts_v2', 'downloadmarketplace', 'digitalmarket'}]
    assert duplicates == []


def test_hashed_download_tokens_are_used():
    assert 'mod_digitalproducts_download_tokens' in read('migrations/V100.php')
    assert 'token_hash' in read('lib/Security/TokenService.php')
    assert 'hash(\'sha256\'' in read('lib/Security/TokenService.php')
    assert '$_SESSION[\'dp_download_' not in read('lib/Core.php')


def test_download_endpoint_never_accepts_customer_ids_as_authority():
    download = read('download.php')
    assert "$_GET['client_id']" not in download
    assert "$_POST['client_id']" not in download
    assert 'authorizeToken' in download
    assert 'Content-Disposition' in download
    assert 'X-Content-Type-Options: nosniff' in download


def test_admin_posts_have_csrf_and_capabilities():
    admin = read('lib/Admin.php')
    assert 'CapabilityPolicy::requirePost' in admin
    assert 'CapabilityPolicy::tokenField()' in admin
    assert 'digitalproducts.files.upload' in admin


def test_api_does_not_accept_query_string_api_tokens():
    api = read('api.php')
    assert "$_GET['api_token']" not in api
    assert 'Authorization' in api or 'HTTP_AUTHORIZATION' in api
    assert 'RateLimiter' in api


def test_storage_is_abstracted_and_private():
    assert (MODULE / 'lib' / 'Storage' / 'StorageInterface.php').exists()
    storage = read('lib/Storage/LocalPrivateStorage.php')
    assert 'CH247_MODULE_STORAGE' in storage
    assert '.htaccess' in storage
    assert 'containsTraversal' in storage
