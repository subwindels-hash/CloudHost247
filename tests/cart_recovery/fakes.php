<?php
/**
 * Cart Recovery test fakes: in-memory Capsule stand-in (same philosophy as
 * tests/marketing/fakes.php) plus controllable WHMCS mail/localAPI doubles.
 * No network, no WHMCS runtime; every behaviour test runs against the real
 * addon classes.
 */

namespace {
    final class CH247CartFakeDB
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
                'mod_cloudhost247_cart_recovery_recoveries' => array(array('token_hash'), array('unsubscribe_hash')),
                'mod_cloudhost247_cart_recovery_reminder_logs' => array(array('recovery_id', 'reminder_number')),
                'mod_cloudhost247_cart_recovery_suppressions' => array(array('email', 'client_id')),
                'mod_cloudhost247_cart_recovery_settings' => array(array('setting')),
                'mod_cloudhost247_cart_recovery_migrations' => array(array('version')),
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

    final class CH247CartFakeSchema
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
            $callback(new CH247CartFakeBlueprint($name));
            CH247CartFakeDB::rowsRef($name);
        }

        public function table($name, $callback)
        {
            $callback(new CH247CartFakeBlueprint($name));
        }

        public function hasColumn($table, $column)
        {
            return isset(self::$columns[$table][$column]);
        }
    }

    /** Records the columns a migration declares so hasColumn() is meaningful. */
    final class CH247CartFakeBlueprint
    {
        private $table;

        public function __construct($table)
        {
            $this->table = $table;
            if (!isset(CH247CartFakeSchema::$columns[$table])) {
                CH247CartFakeSchema::$columns[$table] = array();
            }
        }

        public function __call($method, $arguments)
        {
            $structural = array('unique', 'index', 'primary', 'foreign', 'dropColumn');
            if (in_array($method, $structural, true)) {
                return $this;
            }
            if (isset($arguments[0]) && is_string($arguments[0])) {
                CH247CartFakeSchema::$columns[$this->table][$arguments[0]] = $method;
            }
            return $this;
        }
    }

    final class CH247CartFakeCollection implements \IteratorAggregate, \Countable
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

    final class CH247CartFakeQuery
    {
        private $table;
        private $wheres = array();
        private $orderBy = array();
        private $paging = array('limit' => null, 'offset' => 0);

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
            $rows = &CH247CartFakeDB::rowsRef($this->table);
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
            $rows = &CH247CartFakeDB::rowsRef($this->table);
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
            return new CH247CartFakeCollection($this->rows());
        }

        public function count()
        {
            return count($this->rows());
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
            if (isset(CH247CartFakeSchema::$columns[$this->table])) {
                foreach (CH247CartFakeSchema::$columns[$this->table] as $column => $type) {
                    if (!array_key_exists($column, $data)) {
                        $data[$column] = null;
                    }
                }
            }
            if (!isset($data['id']) && $this->hasAutoId()) {
                $data['id'] = CH247CartFakeDB::nextId($this->table);
            }
            CH247CartFakeDB::assertUnique($this->table, $data);
            $rows = &CH247CartFakeDB::rowsRef($this->table);
            $rows[] = $data;
            return true;
        }

        private function hasAutoId()
        {
            return !in_array($this->table, array(
                'mod_cloudhost247_cart_recovery_settings',
                'mod_cloudhost247_cart_recovery_migrations',
            ), true);
        }

        public function insertGetId(array $data)
        {
            $this->insert($data);
            $rows = &CH247CartFakeDB::rowsRef($this->table);
            $last = end($rows);
            return $last['id'];
        }

        public function update(array $attributes)
        {
            $rows = &CH247CartFakeDB::rowsRef($this->table);
            $affected = 0;
            foreach ($this->matchingIndexes() as $index) {
                $candidate = array_merge($rows[$index], $attributes);
                CH247CartFakeDB::assertUnique($this->table, $candidate, $index);
                $rows[$index] = $candidate;
                $affected++;
            }
            return $affected;
        }

        public function updateOrInsert(array $attributes, array $values)
        {
            $rows = &CH247CartFakeDB::rowsRef($this->table);
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
            $rows = &CH247CartFakeDB::rowsRef($this->table);
            $kept = array();
            $removed = 0;
            foreach ($rows as $index => $row) {
                if (in_array($index, $this->matchingIndexes(), true)) {
                    $removed++;
                } else {
                    $kept[] = $row;
                }
            }
            $ref = &CH247CartFakeDB::rowsRef($this->table);
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
                return new \CH247CartFakeQuery($name);
            }

            public static function schema()
            {
                return new \CH247CartFakeSchema();
            }
        }
    }
}

namespace WHMCS\Mail {
    if (!class_exists('WHMCS\\Mail\\Message')) {
        class Message
        {
            public $recipients = array();
            public $subject = '';
            public $body = '';

            public function setRecipients($type, array $recipients)
            {
                $this->recipients = $recipients;
                return $this;
            }

            public function setSubject($subject)
            {
                $this->subject = $subject;
                return $this;
            }

            public function setBody($body)
            {
                $this->body = $body;
                return $this;
            }

            public function send()
            {
                if (!empty($GLOBALS['CH247_MAIL_FAIL'])) {
                    throw new \RuntimeException('simulated transport failure');
                }
                $GLOBALS['CH247_MAIL_SENT'][] = array(
                    'transport' => 'whmcs-mail',
                    'to' => isset($this->recipients[0][0]) ? $this->recipients[0][0] : '',
                    'subject' => $this->subject,
                    'body' => $this->body,
                );
                return true;
            }
        }
    }
}

namespace {
    if (!function_exists('localAPI')) {
        /** WHMCS Local API double: records SendEmail calls, can simulate failure. */
        function localAPI($command, $data = array(), $adminUsername = null)
        {
            $GLOBALS['CH247_API_CALLS'][] = array('command' => $command, 'data' => $data);
            if ($command !== 'SendEmail') {
                return array('result' => 'error', 'message' => 'unsupported command in tests');
            }
            if (!empty($GLOBALS['CH247_MAIL_FAIL'])) {
                return array('result' => 'error', 'message' => 'simulated delivery failure');
            }
            $variables = array();
            if (isset($data['customvars'])) {
                $decoded = @unserialize(base64_decode($data['customvars']));
                if (is_array($decoded)) {
                    $variables = $decoded;
                }
            }
            $GLOBALS['CH247_MAIL_SENT'][] = array(
                'transport' => 'localapi',
                'to' => isset($variables['customer_email']) ? $variables['customer_email'] : '',
                'client_id' => isset($data['id']) ? (int) $data['id'] : 0,
                'template' => isset($data['messagename']) ? $data['messagename'] : '',
                'variables' => $variables,
            );
            return array('result' => 'success');
        }
    }

    if (!function_exists('logModuleCall')) {
        /** WHMCS module log double so error paths do not pollute test output. */
        function logModuleCall($module, $action, $request, $response = null, $processed = null, $replace = array())
        {
            $GLOBALS['CH247_MODULE_LOG'][] = array('module' => $module, 'action' => $action, 'request' => $request);
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
            $allowed = !isset($GLOBALS['CH247_ADMIN_DENIED']) || !$GLOBALS['CH247_ADMIN_DENIED'];
            return $returnResult ? $allowed : $allowed;
        }
    }

    /** Reset all global state between tests. */
    function ch247_cart_fresh()
    {
        CH247CartFakeDB::reset();
        CH247CartFakeSchema::reset();
        \CloudHost247\CartRecovery\SettingsRepository::flush();
        $GLOBALS['CH247_MAIL_SENT'] = array();
        $GLOBALS['CH247_API_CALLS'] = array();
        $GLOBALS['CH247_MODULE_LOG'] = array();
        $GLOBALS['CH247_MAIL_FAIL'] = false;
        $GLOBALS['CH247_ADMIN_DENIED'] = false;
        $_POST = array();
        $_GET = array();
        $_REQUEST = array();
        $_SESSION = array();
        $_SERVER['REQUEST_METHOD'] = 'GET';
        \CloudHost247\CartRecovery\MigrationRunner::migrate();
        \CloudHost247\CartRecovery\SettingsRepository::seed();
        \CloudHost247\CartRecovery\SettingsRepository::flush();
    }

    /** Create the WHMCS client record a reminder recipient needs. */
    function ch247_cart_client($clientId, $email = 'buyer@example.com', $status = 'Active')
    {
        \WHMCS\Database\Capsule::table('tblclients')->updateOrInsert(
            array('id' => (int) $clientId),
            array('email' => $email, 'firstname' => 'Ada', 'lastname' => 'Ng', 'status' => $status)
        );
    }

    /** Convenience: a realistic WHMCS-shaped cart. */
    function ch247_cart_sample()
    {
        return array(
            'products' => array(
                array(
                    'pid' => 12,
                    'productname' => 'CloudHost247 Business Hosting',
                    'productgroup' => 'Web Hosting',
                    'billingcycle' => 'annually',
                    'domain' => 'example.com',
                    'qty' => 1,
                    'price' => 45000.00,
                    'configoptions' => array('4' => '2'),
                    'customfields' => array('7' => 'preferred-node'),
                    // Anything sensitive must never survive the snapshot:
                    'cc_number' => '4111111111111111',
                    'cvv' => '123',
                    'password' => 'hunter2',
                ),
            ),
            'domains' => array(
                array('domain' => 'example.ng', 'domaintype' => 'register', 'regperiod' => 2, 'price' => 9000.00),
            ),
            'sessiontoken' => 'must-not-be-copied',
        );
    }

    /** Move a recovery record's timestamps into the past. */
    function ch247_cart_age($recoveryId, $seconds)
    {
        $when = date('Y-m-d H:i:s', time() - (int) $seconds);
        \CloudHost247\CartRecovery\RecoveryService::table()
            ->where('id', (int) $recoveryId)
            ->update(array('last_activity_at' => $when, 'first_seen_at' => $when, 'created_at' => $when));
    }

    function ch247_cart_age_abandonment($recoveryId, $seconds)
    {
        $when = date('Y-m-d H:i:s', time() - (int) $seconds);
        \CloudHost247\CartRecovery\RecoveryService::table()
            ->where('id', (int) $recoveryId)
            ->update(array('abandoned_at' => $when, 'next_reminder_at' => $when));
    }
}
