<?php
/** SQLite-backed repository tests with a small WHMCS Capsule adapter. */
namespace WHMCS\Database {
    final class Capsule {
        public static $db;
        public static function table($name) { return new Query(self::$db, $name); }
    }
    final class Query {
        private $db; private $table; private $where = array(); private $args = array();
        public function __construct($db, $table) { $this->db = $db; $this->table = $table; }
        public function where($key, $value) { $this->where[] = "`$key` = ?"; $this->args[] = $value; return $this; }
        private function clause() { return $this->where ? ' WHERE ' . implode(' AND ', $this->where) : ''; }
        public function first() { $q = $this->db->prepare("SELECT * FROM `{$this->table}`" . $this->clause() . ' LIMIT 1'); $q->execute($this->args); $r = $q->fetch(\PDO::FETCH_OBJ); return $r ?: null; }
        public function exists() { return $this->first() !== null; }
        public function count() { $q = $this->db->prepare("SELECT count(*) FROM `{$this->table}`" . $this->clause()); $q->execute($this->args); return (int) $q->fetchColumn(); }
        public function delete() { $q = $this->db->prepare("DELETE FROM `{$this->table}`" . $this->clause()); $q->execute($this->args); return $q->rowCount(); }
        public function update($values) { $sets = array(); foreach (array_keys($values) as $key) $sets[] = "`$key` = ?"; $q = $this->db->prepare("UPDATE `{$this->table}` SET " . implode(',', $sets) . $this->clause()); $q->execute(array_merge(array_values($values), $this->args)); return $q->rowCount(); }
    }
}
namespace CloudHost247\Foundation\Support {
    final class AuditLogger { public static $events = array(); public static function record() { self::$events[] = func_get_args(); } }
}
namespace {
    $root = dirname(__DIR__, 2); $lib = $root . '/modules/addons/cloudhost247_smm/lib/';
    require $lib . 'Contracts/ProviderFinder.php';
    require $lib . 'Contracts/ApiRecorder.php';
    require $lib . 'Support/HttpTransport.php';
    require $lib . 'Support/CurlTransport.php';
    require $lib . 'Adapters/AdapterFactory.php';
    require $lib . 'Repositories/ProviderRepository.php';
    require $lib . 'Services/ProviderService.php';
    class TestRecorder implements \CloudHost247\Smm\Contracts\ApiRecorder {
        public function record($providerId, $operation, array $request, $response, $httpStatus, $durationMs, $result, $correlationId) {}
    }
    use WHMCS\Database\Capsule;
    use CloudHost247\Smm\Repositories\ProviderRepository;
    use CloudHost247\Smm\Services\ProviderService;
    use CloudHost247\Smm\Adapters\AdapterFactory;
    Capsule::$db = new \PDO('sqlite::memory:');
    Capsule::$db->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
    foreach (array(
        'CREATE TABLE mod_cloudhost247_smm_providers (id INTEGER PRIMARY KEY, name TEXT)',
        'CREATE TABLE mod_cloudhost247_smm_services (id INTEGER PRIMARY KEY, provider_id INTEGER, provider_service_id TEXT)',
        'CREATE TABLE mod_cloudhost247_smm_mappings (id INTEGER PRIMARY KEY, provider_id INTEGER, service_id INTEGER, enabled INTEGER, updated_at TEXT)',
        'CREATE TABLE mod_cloudhost247_smm_orders (id INTEGER PRIMARY KEY, provider_id INTEGER, provider_service_id TEXT)',
        "INSERT INTO mod_cloudhost247_smm_providers VALUES (1, 'First'), (2, 'Second')",
        "INSERT INTO mod_cloudhost247_smm_services VALUES (1,1,'unused'), (2,1,'mapped'), (3,1,'historic'), (4,2,'other')",
        'INSERT INTO mod_cloudhost247_smm_mappings (id,provider_id,service_id,enabled) VALUES (1,1,2,1)',
        "INSERT INTO mod_cloudhost247_smm_orders VALUES (1,1,'historic')",
    ) as $sql) Capsule::$db->prepare($sql)->execute();
    function check_delete($ok, $label) { if (!$ok) { echo "FAIL $label\n"; exit(1); } echo "PASS $label\n"; }
    $repo = new ProviderRepository();
    check_delete($repo->deleteService(1), 'unused service is deleted');
    check_delete(!$repo->deleteService(2) && $repo->findService(2) !== null, 'mapped service is preserved');
    check_delete(!$repo->deleteService(3) && $repo->findService(3) !== null, 'service with order history is preserved');
    check_delete(!$repo->deleteService(999), 'unknown service is rejected');
    $provider = new ProviderService($repo, new TestRecorder(), new AdapterFactory());
    check_delete(!$provider->delete(2, false, 1)['ok'] && $repo->find(2) !== null, 'provider deletion requires confirmation');
    check_delete(!$provider->delete(1, true, 1)['ok'] && $repo->find(1) !== null, 'provider with orders is preserved');
    check_delete($provider->delete(2, true, 1)['ok'] && $repo->find(2) === null && $repo->findService(4) === null, 'unused provider and its catalog are deleted');
    check_delete(count(\CloudHost247\Foundation\Support\AuditLogger::$events) === 1, 'provider deletion writes an audit event');
    echo "SQLite tests passed; actual WHMCS/MySQL access not exercised.\n";
}
