<?php
/** SQLite-backed query adapter for operation/lock tests; not a WHMCS integration test. */
namespace WHMCS\Database {
    final class Capsule {
        public static $db;
        public static $race = false;
        public static function table($name) { return new Query(self::$db, $name); }
    }
    final class Query {
        private $db; private $table; private $where = []; private $args = [];
        public function __construct($db, $table) { $this->db = $db; $this->table = $table; }
        public function where($name, $operator, $value = null) {
            if (func_num_args() === 2) { $value = $operator; $operator = '='; }
            $this->where[] = "`$name` $operator ?"; $this->args[] = $value; return $this;
        }
        private function clause() { return $this->where ? ' WHERE ' . implode(' AND ', $this->where) : ''; }
        public function first() {
            $q = $this->db->prepare("SELECT * FROM `{$this->table}`" . $this->clause() . ' LIMIT 1');
            $q->execute($this->args); $r = $q->fetch(\PDO::FETCH_OBJ); return $r ?: null;
        }
        public function insert($row) {
            $names = array_keys($row); $columns = implode(',', array_map(static function ($n) { return "`$n`"; }, $names));
            $q = $this->db->prepare("INSERT INTO `{$this->table}` ($columns) VALUES (" . implode(',', array_fill(0, count($names), '?')) . ')');
            return $q->execute(array_values($row));
        }
        public function update($row) {
            if (Capsule::$race && $this->table === 'mod_cloudhost247_email_hosting_operations') {
                Capsule::$race = false;
                $this->db->exec("UPDATE mod_cloudhost247_email_hosting_operations SET state='in_progress' WHERE state='failed'");
            }
            $sets = []; foreach (array_keys($row) as $name) $sets[] = "`$name` = ?";
            $q = $this->db->prepare("UPDATE `{$this->table}` SET " . implode(',', $sets) . $this->clause());
            $q->execute(array_merge(array_values($row), $this->args)); return $q->rowCount();
        }
        public function delete() {
            $q = $this->db->prepare("DELETE FROM `{$this->table}`" . $this->clause());
            $q->execute($this->args); return $q->rowCount();
        }
    }
}
namespace {
    require dirname(__DIR__, 2) . '/modules/servers/cloudhost247_email_hosting/bootstrap.php';
    use WHMCS\Database\Capsule;
    use CloudHost247\Email\Repository\OperationRepository as Ops;
    use CloudHost247\Email\Support\Lock;
    use CloudHost247\Email\Support\Result;

    Capsule::$db = new \PDO('sqlite::memory:');
    Capsule::$db->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
    Capsule::$db->exec('CREATE TABLE mod_cloudhost247_email_hosting_operations (service_id INTEGER, provider TEXT, operation TEXT, idempotency_key TEXT UNIQUE, state TEXT, attempts INTEGER, correlation_id TEXT, result_code TEXT, result_message TEXT, remote_id TEXT, created_at TEXT, updated_at TEXT)');
    Capsule::$db->exec('CREATE TABLE mod_cloudhost247_email_hosting_locks (lock_key TEXT PRIMARY KEY, owner TEXT, acquired_at TEXT, expires_at TEXT)');
    function check($condition, $message) { if (!$condition) { echo "FAIL $message\n"; exit(1); } echo "PASS $message\n"; }
    $first = Ops::begin(42, 'microsoft365', 'create', ['sku' => 'x']);
    check($first['claimed'], 'first operation claims key');
    check(!Ops::begin(42, 'microsoft365', 'create', ['sku' => 'x'])['claimed'], 'in-progress operation is not repeated');
    Ops::finish($first['key'], Result::uncertain('timeout'));
    check(!Ops::begin(42, 'microsoft365', 'create', ['sku' => 'x'])['claimed'], 'uncertain operation cannot be retried');
    $retry = Ops::begin(43, 'microsoft365', 'create', ['sku' => 'x']);
    Ops::finish($retry['key'], Result::fail(Result::CODE_CONFIG, 'rejected'));
    Capsule::$race = true;
    check(!Ops::begin(43, 'microsoft365', 'create', ['sku' => 'x'])['claimed'], 'stale failed-state reader loses atomic retry claim');
    $another = Ops::begin(44, 'microsoft365', 'create', []);
    Ops::finish($another['key'], Result::fail(Result::CODE_CONFIG, 'rejected'));
    $claimed = Ops::begin(44, 'microsoft365', 'create', []);
    check($claimed['claimed'] && (int) $claimed['row']->attempts === 2, 'failed operation can be claimed once');
    check(Lock::acquire('service:42'), 'lock acquired');
    Capsule::$db->exec("UPDATE mod_cloudhost247_email_hosting_locks SET owner='new-owner' WHERE lock_key='service:42'");
    Lock::release('service:42');
    check((int) Capsule::$db->query("SELECT count(*) FROM mod_cloudhost247_email_hosting_locks WHERE owner='new-owner'")->fetchColumn() === 1, 'expired owner cannot release a successor lock');
    echo "SQLite repository tests passed; WHMCS/MySQL integration not tested.\n";
}
