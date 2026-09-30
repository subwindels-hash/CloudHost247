<?php
/**
 * Passkey test fakes: in-memory Capsule stand-in (the same engine as
 * tests/cart_recovery/fakes.php, with this addon's unique indexes) plus
 * WHMCS function doubles. No network and no WHMCS runtime; every behaviour
 * test runs against the real addon classes and real OpenSSL cryptography.
 */

namespace {
    final class CH247PkFakeDB
    {
        private static $tables = array();
        private static $auto = array();
        /** table => list of unique column-sets, emulating the real indexes */
        private static $unique = array();

        public static function reset()
        {
            self::$tables = array();
            self::$auto = array();
            self::$unique = array(
                'mod_cloudhost247_passkey_credentials' => array(array('credential_id_hash')),
                'mod_cloudhost247_passkey_challenges' => array(array('challenge_hash')),
                'mod_cloudhost247_passkey_policies' => array(array('user_type', 'user_id')),
                'mod_cloudhost247_passkey_identities' => array(array('provider', 'subject')),
                'mod_cloudhost247_passkey_rate_limits' => array(array('subject_hash')),
                'mod_cloudhost247_passkey_settings' => array(array('setting_key')),
                'mod_cloudhost247_passkey_migrations' => array(array('version')),
            );
        }

        public static function &rowsRef($table)
        {
            if (!isset(self::$tables[$table])) {
                self::$tables[$table] = array();
            }
            return self::$tables[$table];
        }

        public static function nextId($table)
        {
            if (!isset(self::$auto[$table])) {
                self::$auto[$table] = 0;
            }
            return ++self::$auto[$table];
        }

        public static function uniqueKeys($table)
        {
            return isset(self::$unique[$table]) ? self::$unique[$table] : array();
        }

        public static function assertUnique($table, array $candidate, $ignoreIndex = null)
        {
            foreach (self::uniqueKeys($table) as $columns) {
                $relevant = true;
                foreach ($columns as $column) {
                    if (!array_key_exists($column, $candidate) || $candidate[$column] === null) {
                        $relevant = false;
                    }
                }
                if (!$relevant) {
                    continue;
                }
                foreach (self::rowsRef($table) as $index => $row) {
                    if ($index === $ignoreIndex) {
                        continue;
                    }
                    $same = true;
                    foreach ($columns as $column) {
                        if (!array_key_exists($column, $row) || $row[$column] != $candidate[$column]) {
                            $same = false;
                            break;
                        }
                    }
                    if ($same) {
                        throw new \RuntimeException('Duplicate entry for unique key ' . implode(',', $columns) . ' on ' . $table);
                    }
                }
            }
        }
    }

    final class CH247PkFakeSchema
    {
        public static $created = array();
        public static $columns = array();

        public static function reset()
        {
            self::$created = array();
            self::$columns = array();
        }

        public function hasTable($name)
        {
            return isset(self::$created[$name]);
        }

        public function create($name, $callback)
        {
            self::$created[$name] = true;
            self::$columns[$name] = array();
            $callback(new CH247PkFakeBlueprint($name));
            CH247PkFakeDB::rowsRef($name);
        }

        public function table($name, $callback)
        {
            $callback(new CH247PkFakeBlueprint($name));
        }

        public function hasColumn($table, $column)
        {
            return isset(self::$columns[$table][$column]);
        }
    }

    /** Records the columns a migration declares so hasColumn() is meaningful. */
    final class CH247PkFakeBlueprint
    {
        private $table;

        public function __construct($table)
        {
            $this->table = $table;
            if (!isset(CH247PkFakeSchema::$columns[$table])) {
                CH247PkFakeSchema::$columns[$table] = array();
            }
        }

        public function __call($method, $arguments)
        {
            $structural = array('unique', 'index', 'primary', 'foreign', 'dropColumn');
            if (in_array($method, $structural, true)) {
                return $this;
            }
            if (isset($arguments[0]) && is_string($arguments[0])) {
                CH247PkFakeSchema::$columns[$this->table][$arguments[0]] = $method;
            }
            return $this;
        }
    }

    final class CH247PkFakeCollection implements \IteratorAggregate, \Countable
    {
        private $rows;

        public function __construct(array $rows)
        {
            $this->rows = $rows;
        }

        public function getIterator(): \Traversable
        {
            return new \ArrayIterator($this->all());
        }

        public function count(): int
        {
            return count($this->rows);
        }

        public function all()
        {
            return array_map(function ($row) {
                return (object) $row;
            }, $this->rows);
        }

        public function isEmpty()
        {
            return count($this->rows) === 0;
        }
    }

    final class CH247PkFakeQuery
    {
        private $table;
        private $wheres = array();
        private $orderBy = array();
        private $paging = array('limit' => null, 'offset' => 0);
        private $distinct = false;

        public function __construct($table)
        {
            $this->table = $table;
        }

        public function where($column, $operator = null, $value = null, $boolean = 'and')
        {
            if ($column instanceof \Closure) {
                $group = new self($this->table);
                $column($group);
                $this->wheres[] = array('type' => 'group', 'boolean' => $boolean, 'conditions' => $group->conditions());
                return $this;
            }
            if ($value === null && $operator !== null && !in_array($operator, array('=', '!=', '<', '<=', '>', '>=', 'like'), true)) {
                $value = $operator;
                $operator = '=';
            }
            $this->wheres[] = array('type' => 'basic', 'boolean' => $boolean, 'column' => $column, 'operator' => $operator ?: '=', 'value' => $value);
            return $this;
        }

        public function orWhere($column, $operator = null, $value = null)
        {
            return $this->where($column, $operator, $value, 'or');
        }

        public function conditions()
        {
            return $this->wheres;
        }

        public function whereNull($column)
        {
            return $this->where($column, '=', null);
        }

        public function whereNotNull($column)
        {
            return $this->where($column, 'notnull', true);
        }

        public function whereIn($column, array $values)
        {
            $this->wheres[] = array('type' => 'basic', 'boolean' => 'and', 'column' => $column, 'operator' => 'in', 'value' => $values);
            return $this;
        }

        public function orderBy($column, $direction = 'asc')
        {
            $this->orderBy[] = array($column, strtolower($direction) === 'desc' ? 'desc' : 'asc');
            return $this;
        }

        public function limit($n)
        {
            $this->paging['limit'] = (int) $n;
            return $this;
        }

        public function offset($n)
        {
            $this->paging['offset'] = (int) $n;
            return $this;
        }

        public function when($condition, $callback)
        {
            if ($condition) {
                $callback($this);
            }
            return $this;
        }

        private static function evaluate(array $conditions, array $row)
        {
            $result = null;
            foreach ($conditions as $condition) {
                if ($condition['type'] === 'group') {
                    $value = self::evaluate($condition['conditions'], $row);
                } else {
                    $value = self::compare($condition, $row);
                }
                if ($result === null) {
                    $result = $value;
                } elseif ($condition['boolean'] === 'or') {
                    $result = $result || $value;
                } else {
                    $result = $result && $value;
                }
            }
            return $result === null ? true : $result;
        }

        private static function compare(array $condition, array $row)
        {
            $actual = array_key_exists($condition['column'], $row) ? $row[$condition['column']] : null;
            $expected = $condition['value'];
            switch ($condition['operator']) {
                case '=':
                    return $expected === null ? $actual === null : ($actual !== null && $actual == $expected);
                case '!=':
                    return $expected === null ? $actual !== null : $actual != $expected;
                case '>': return $actual !== null && $actual > $expected;
                case '>=': return $actual !== null && $actual >= $expected;
                case '<': return $actual !== null && $actual < $expected;
                case '<=': return $actual !== null && $actual <= $expected;
                case 'in': return in_array($actual, $expected);
                case 'notnull': return $actual !== null;
                case 'like':
                    $pattern = '/^' . str_replace('%', '.*', preg_quote((string) $expected, '/')) . '$/i';
                    $pattern = str_replace('\%', '.*', $pattern);
                    return $actual !== null && preg_match($pattern, (string) $actual) === 1;
            }
            return false;
        }

        private function matchingIndexes()
        {
            $rows = &CH247PkFakeDB::rowsRef($this->table);
            $out = array();
            foreach ($rows as $index => $row) {
                if (self::evaluate($this->wheres, $row)) {
                    $out[] = $index;
                }
            }
            return $out;
        }

        private function rows()
        {
            $rows = &CH247PkFakeDB::rowsRef($this->table);
            $out = array();
            foreach ($this->matchingIndexes() as $index) {
                $out[] = $rows[$index];
            }
            foreach (array_reverse($this->orderBy) as $order) {
                usort($out, function ($a, $b) use ($order) {
                    $av = isset($a[$order[0]]) ? $a[$order[0]] : null;
                    $bv = isset($b[$order[0]]) ? $b[$order[0]] : null;
                    if ($av == $bv) {
                        return 0;
                    }
                    $cmp = ($av < $bv) ? -1 : 1;
                    return $order[1] === 'desc' ? -$cmp : $cmp;
                });
            }
            if ($this->paging['offset'] > 0 || $this->paging['limit'] !== null) {
                $out = array_slice($out, $this->paging['offset'], $this->paging['limit'] === null ? null : $this->paging['limit']);
            }
            return $out;
        }

        public function first($columns = null)
        {
            $rows = $this->rows();
            return $rows ? (object) $rows[0] : null;
        }

        public function get()
        {
            return new CH247PkFakeCollection($this->rows());
        }

        public function distinct()
        {
            $this->distinct = true;
            return $this;
        }

        public function count($column = null)
        {
            $rows = $this->rows();
            if ($this->distinct && $column !== null) {
                $seen = array();
                foreach ($rows as $row) {
                    $seen[(string) (isset($row[$column]) ? $row[$column] : '')] = true;
                }
                return count($seen);
            }
            return count($rows);
        }

        public function exists()
        {
            return count($this->rows()) > 0;
        }

        public function sum($column)
        {
            $total = 0.0;
            foreach ($this->rows() as $row) {
                if (isset($row[$column]) && is_numeric($row[$column])) {
                    $total += (float) $row[$column];
                }
            }
            return $total;
        }

        public function insert(array $data)
        {
            // Mirror a real table: every declared column exists on the row.
            if (isset(CH247PkFakeSchema::$columns[$this->table])) {
                foreach (CH247PkFakeSchema::$columns[$this->table] as $column => $type) {
                    if (!array_key_exists($column, $data)) {
                        $data[$column] = null;
                    }
                }
            }
            if (!isset($data['id']) && $this->hasAutoId()) {
                $data['id'] = CH247PkFakeDB::nextId($this->table);
            }
            CH247PkFakeDB::assertUnique($this->table, $data);
            $rows = &CH247PkFakeDB::rowsRef($this->table);
            $rows[] = $data;
            return true;
        }

        private function hasAutoId()
        {
            return !in_array($this->table, array(
                'mod_cloudhost247_passkey_migrations',
            ), true);
        }

        public function insertGetId(array $data)
        {
            $this->insert($data);
            $rows = &CH247PkFakeDB::rowsRef($this->table);
            $last = end($rows);
            return $last['id'];
        }

        public function update(array $attributes)
        {
            $rows = &CH247PkFakeDB::rowsRef($this->table);
            $affected = 0;
            foreach ($this->matchingIndexes() as $index) {
                $candidate = array_merge($rows[$index], $attributes);
                CH247PkFakeDB::assertUnique($this->table, $candidate, $index);
                $rows[$index] = $candidate;
                $affected++;
            }
            return $affected;
        }

        public function updateOrInsert(array $attributes, array $values)
        {
            $rows = &CH247PkFakeDB::rowsRef($this->table);
            foreach ($rows as $index => $row) {
                $matches = true;
                foreach ($attributes as $key => $value) {
                    $actual = array_key_exists($key, $row) ? $row[$key] : null;
                    if ($value === null ? $actual !== null : $actual != $value) {
                        $matches = false;
                        break;
                    }
                }
                if ($matches) {
                    $rows[$index] = array_merge($row, $values);
                    return true;
                }
            }
            return $this->insert(array_merge($attributes, $values));
        }

        public function delete()
        {
            $rows = &CH247PkFakeDB::rowsRef($this->table);
            $kept = array();
            $removed = 0;
            foreach ($rows as $index => $row) {
                if (in_array($index, $this->matchingIndexes(), true)) {
                    $removed++;
                } else {
                    $kept[] = $row;
                }
            }
            $ref = &CH247PkFakeDB::rowsRef($this->table);
            $ref = array_values($kept);
            return $removed;
        }
    }
}

namespace WHMCS\Database {
    if (!class_exists('WHMCS\\Database\\Capsule')) {
        final class Capsule
        {
            public static function table($name)
            {
                return new \CH247PkFakeQuery($name);
            }

            public static function schema()
            {
                return new \CH247PkFakeSchema();
            }
        }
    }
}

namespace {
    if (!function_exists('localAPI')) {
        /** WHMCS Local API double: records calls, can simulate failure. */
        function localAPI($command, $data = array(), $adminUsername = null)
        {
            $GLOBALS['CH247_PK_API_CALLS'][] = array('command' => $command, 'data' => $data);
            if (!empty($GLOBALS['CH247_PK_API_FAIL'])) {
                return array('result' => 'error', 'message' => 'simulated failure');
            }
            if ($command === 'SendEmail') {
                $variables = array();
                if (isset($data['customvars'])) {
                    $decoded = @json_decode(base64_decode($data['customvars']), true);
                    if (!is_array($decoded)) {
                        $decoded = @unserialize(base64_decode($data['customvars']));
                    }
                    if (is_array($decoded)) {
                        $variables = $decoded;
                    }
                }
                $GLOBALS['CH247_PK_MAIL_SENT'][] = array(
                    'template' => isset($data['messagename']) ? $data['messagename'] : '',
                    'client_id' => isset($data['id']) ? (int) $data['id'] : 0,
                    'variables' => $variables,
                );
                return array('result' => 'success');
            }
            if ($command === 'UpdateClient') {
                $GLOBALS['CH247_PK_PASSWORD_UPDATES'][] = array(
                    'clientid' => isset($data['clientid']) ? (int) $data['clientid'] : 0,
                    // Deliberately records only the length: a test fixture
                    // must not keep a plaintext password around either.
                    'length' => isset($data['password2']) ? strlen((string) $data['password2']) : 0,
                );
                return array('result' => 'success');
            }
            return array('result' => 'error', 'message' => 'unsupported command in tests');
        }
    }

    if (!function_exists('logModuleCall')) {
        function logModuleCall($module, $action, $request, $response = null, $processed = null, $replace = array())
        {
            $GLOBALS['CH247_PK_MODULE_LOG'][] = array('module' => $module, 'action' => $action, 'request' => $request);
            return true;
        }
    }

    if (!function_exists('generate_token')) {
        function generate_token($format = 'plain')
        {
            return str_repeat('ab', 16);
        }
    }
    if (!function_exists('check_token')) {
        function check_token($scope = '')
        {
            return !empty($_REQUEST['token']) && $_REQUEST['token'] === str_repeat('ab', 16);
        }
    }
    if (!function_exists('checkPermission')) {
        function checkPermission($permission, $returnResult = false)
        {
            return !isset($GLOBALS['CH247_PK_ADMIN_DENIED']) || !$GLOBALS['CH247_PK_ADMIN_DENIED'];
        }
    }
    if (!function_exists('get_client_ip')) {
        function get_client_ip()
        {
            return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '198.51.100.7';
        }
    }

    /** Reset all global state between tests and install a working config. */
    function ch247_pk_fresh(array $settings = array())
    {
        \CH247PkFakeDB::reset();
        \CH247PkFakeSchema::reset();
        $GLOBALS['CH247_PK_MAIL_SENT'] = array();
        $GLOBALS['CH247_PK_API_CALLS'] = array();
        $GLOBALS['CH247_PK_API_FAIL'] = false;
        $GLOBALS['CH247_PK_MODULE_LOG'] = array();
        $GLOBALS['CH247_PK_PASSWORD_UPDATES'] = array();
        $GLOBALS['CH247_PK_ADMIN_DENIED'] = false;
        $_POST = array();
        $_GET = array();
        $_REQUEST = array();
        $_SESSION = array('ch247_passkey_sid' => 'test-session');
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REMOTE_ADDR'] = '198.51.100.7';
        $_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Macintosh)';
        $_SERVER['HTTPS'] = 'on';

        \CloudHost247\Passkey\SettingsRepository::flush();
        \CloudHost247\Passkey\MigrationRunner::migrate();
        \CloudHost247\Passkey\SettingsRepository::seed();
        \CloudHost247\Passkey\SettingsRepository::flush();
        \CloudHost247\Passkey\SettingsRepository::save(array_merge(array(
            'enabled' => '1',
            'rp_name' => 'CloudHost247',
            'rp_id' => 'example.com',
            'allowed_origins' => 'https://portal.example.com',
            'environment' => 'production',
        ), $settings));
        \CloudHost247\Passkey\SettingsRepository::flush();
    }

    function ch247_pk_client($clientId, $email = 'ada@example.com', $status = 'Active')
    {
        \WHMCS\Database\Capsule::table('tblclients')->updateOrInsert(
            array('id' => (int) $clientId),
            array('email' => $email, 'firstname' => 'Ada', 'lastname' => 'Ng', 'status' => $status)
        );
    }

    function ch247_pk_admin($adminId, $email = 'root@example.com', $disabled = '0')
    {
        \WHMCS\Database\Capsule::table('tbladmins')->updateOrInsert(
            array('id' => (int) $adminId),
            array('email' => $email, 'username' => 'root', 'firstname' => 'Root', 'lastname' => 'Admin', 'disabled' => $disabled)
        );
    }
}
