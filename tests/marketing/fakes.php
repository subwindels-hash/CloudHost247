<?php
/**
 * Marketing test fakes: in-memory Capsule stand-in (same philosophy as
 * tests/broker/fakes.php) plus deterministic CSRF helpers. No network, no
 * WHMCS runtime; every behavior test runs against the real module classes.
 */

namespace {
    final class CH247MarketingFakeDB
    {
        private static $tables = array();
        private static $auto = array();

        public static function reset()
        {
            self::$tables = array();
            self::$auto = array();
        }

        public static function &rowsRef($table)
        {
            if (!isset(self::$tables[$table])) { self::$tables[$table] = array(); }
            return self::$tables[$table];
        }

        public static function nextId($table)
        {
            if (!isset(self::$auto[$table])) { self::$auto[$table] = 0; }
            return ++self::$auto[$table];
        }
    }

    final class CH247MarketingFakeSchema
    {
        public static $created = array();

        public static function reset() { self::$created = array(); }

        public function hasTable($name) { return isset(self::$created[$name]); }

        public function create($name, $callback)
        {
            self::$created[$name] = true;
            CH247MarketingFakeDB::rowsRef($name);
        }

        public function hasColumn($table, $column) { return true; }

        public function table($table, $callback) {}
    }

    final class CH247MarketingFakeCollection implements \IteratorAggregate, \Countable
    {
        private $rows;
        public function __construct(array $rows) { $this->rows = $rows; }
        public function getIterator() { return new \ArrayIterator(array_map(function ($r) { return (object) $r; }, $this->rows)); }
        public function count() { return count($this->rows); }
        public function all() { return array_map(function ($r) { return (object) $r; }, $this->rows); }
        public function isEmpty() { return count($this->rows) === 0; }
    }

    final class CH247MarketingFakeQuery
    {
        private $table;
        private $wheres = array();
        private $orderBy = array();
        private $paging = array('limit' => null, 'offset' => 0);
        private $selectCount = false;

        public function __construct($table) { $this->table = $table; }

        public function where($column, $operator = null, $value = null)
        {
            return $this->addWhere('and', $column, $operator, $value);
        }

        /** Nested OR group support: where(function ($q) { $q->where(...)->orWhere(...); }) */
        public function orWhere($column, $operator = null, $value = null)
        {
            return $this->addWhere('or', $column, $operator, $value);
        }

        private function addWhere($boolean, $column, $operator = null, $value = null)
        {
            if ($column instanceof \Closure) {
                $group = new CH247MarketingFakeQuery($this->table);
                $column($group);
                // The first condition inside a group is always ANDed with the rest of the query.
                $this->wheres[] = array('__group', $group, null, 'and');
                return $this;
            }
            if ($value === null && $operator !== null) { $value = $operator; $operator = '='; }
            $this->wheres[] = array($column, $operator ?: '=', $value, $boolean);
            return $this;
        }

        public function whereNull($column) { return $this->where($column, '=', null); }
        public function whereNotNull($column) { return $this->where($column, '!=', null); }

        public function whereIn($column, array $values)
        {
            $this->wheres[] = array($column, 'in', $values, 'and');
            return $this;
        }

        public function when($value, $callback)
        {
            if ($value) { $callback($this); }
            return $this;
        }

        public function orderBy($column, $direction = 'asc')
        {
            $this->orderBy[] = array($column, strtolower($direction) === 'desc' ? 'desc' : 'asc');
            return $this;
        }

        public function limit($n) { $this->paging['limit'] = (int) $n; return $this; }
        public function offset($n) { $this->paging['offset'] = (int) $n; return $this; }
        public function take($n) { return $this->limit($n); }
        public function skip($n) { return $this->offset($n); }

        /** Evaluates one row against the collected conditions (AND/OR aware). */
        public function match(array $row)
        {
            if (!$this->wheres) { return true; }
            $result = null;
            foreach ($this->wheres as $w) {
                if ($w[0] === '__group') {
                    $ok = $w[1]->match($row);
                } else {
                    $ok = $this->compare($row, $w[0], $w[1], $w[2]);
                }
                $boolean = isset($w[3]) ? $w[3] : 'and';
                if ($result === null) { $result = $ok; }
                elseif ($boolean === 'or') { $result = $result || $ok; }
                else { $result = $result && $ok; }
            }
            return (bool) $result;
        }

        private function compare(array $row, $column, $operator, $value)
        {
            $actual = array_key_exists($column, $row) ? $row[$column] : null;
            switch ($operator) {
                case '=': return ($actual == $value);
                case '!=': return ($actual != $value);
                case '>': return ($actual > $value);
                case '>=': return ($actual >= $value);
                case '<': return ($actual < $value);
                case '<=': return ($actual <= $value);
                case 'in': return in_array($actual, (array) $value);
                case 'not in': return !in_array($actual, (array) $value);
                case 'like':
                case 'not like':
                    $pattern = '/^' . str_replace(array('%', '_'), array('.*', '.'), preg_quote((string) $value, '/')) . '$/is';
                    $matched = (bool) preg_match($pattern, (string) $actual);
                    return $operator === 'like' ? $matched : !$matched;
                default: return false;
            }
        }

        private function rows()
        {
            $rows = &CH247MarketingFakeDB::rowsRef($this->table);
            $out = array();
            foreach ($rows as $row) {
                if ($this->match($row)) { $out[] = $row; }
            }
            foreach (array_reverse($this->orderBy) as $order) {
                usort($out, function ($a, $b) use ($order) {
                    $av = isset($a[$order[0]]) ? $a[$order[0]] : null;
                    $bv = isset($b[$order[0]]) ? $b[$order[0]] : null;
                    if ($av == $bv) { return 0; }
                    $cmp = ($av < $bv) ? -1 : 1;
                    return $order[1] === 'desc' ? -$cmp : $cmp;
                });
            }
            if ($this->paging['offset'] > 0 || $this->paging['limit'] !== null) {
                $out = array_slice($out, $this->paging['offset'], $this->paging['limit'] === null ? null : $this->paging['limit']);
            }
            return $out;
        }

        public function first()
        {
            $rows = $this->rows();
            if ($this->selectCount) {
                return (object) array('aggregate' => count($rows));
            }
            return $rows ? (object) $rows[0] : null;
        }

        public function get() { return new CH247MarketingFakeCollection($this->rows()); }
        public function count() { return count($this->rows()); }
        public function exists() { return count($this->rows()) > 0; }

        public function selectRaw($expression)
        {
            if (preg_match('/COUNT\s*\(\s*\*\s*\)\s+AS\s+aggregate/i', $expression)) {
                $this->selectCount = true;
            }
            return $this;
        }

        public function insert(array $data)
        {
            if (!isset($data['id'])) { $data['id'] = CH247MarketingFakeDB::nextId($this->table); }
            $rows = &CH247MarketingFakeDB::rowsRef($this->table);
            $rows[] = $data;
            return true;
        }

        public function insertGetId(array $data)
        {
            $this->insert($data);
            $rows = &CH247MarketingFakeDB::rowsRef($this->table);
            $last = end($rows);
            return $last['id'];
        }

        public function update(array $attributes)
        {
            $rows = &CH247MarketingFakeDB::rowsRef($this->table);
            $affected = 0;
            foreach ($rows as $i => $row) {
                if ($this->match($row)) { $rows[$i] = array_merge($row, $attributes); $affected++; }
            }
            return $affected;
        }

        public function updateOrInsert(array $attributes, array $values)
        {
            $rows = &CH247MarketingFakeDB::rowsRef($this->table);
            foreach ($rows as $i => $row) {
                $matches = true;
                foreach ($attributes as $key => $value) {
                    if (!array_key_exists($key, $row) || $row[$key] != $value) { $matches = false; break; }
                }
                if ($matches) { $rows[$i] = array_merge($row, $values); return true; }
            }
            $this->insert(array_merge($attributes, $values));
            return true;
        }

        public function delete()
        {
            $rows = &CH247MarketingFakeDB::rowsRef($this->table);
            $kept = array();
            $removed = 0;
            foreach ($rows as $row) {
                if ($this->match($row)) { $removed++; } else { $kept[] = $row; }
            }
            CH247MarketingFakeDB::rowsRef($this->table);
            $ref = &CH247MarketingFakeDB::rowsRef($this->table);
            $ref = array_values($kept);
            return $removed;
        }
    }
}

namespace WHMCS\Database {
    if (!class_exists('WHMCS\\Database\\Capsule')) {
        final class Capsule
        {
            public static function table($name) { return new \CH247MarketingFakeQuery($name); }
            public static function schema() { return new \CH247MarketingFakeSchema(); }
            public static function connection()
            {
                return new class {
                    public function transaction($callback) { return $callback(); }
                };
            }
        }
    }
}

namespace {
    if (!function_exists('generate_token')) {
        function generate_token($format) { return str_repeat('ab', 16); }
    }
    if (!function_exists('check_token')) {
        function check_token($scope) { return !empty($_REQUEST['token']) && $_REQUEST['token'] === str_repeat('ab', 16); }
    }

    function ch247_marketing_fresh()
    {
        CH247MarketingFakeDB::reset();
        CH247MarketingFakeSchema::reset();
        // Foundation tables the module legitimately coexists with (capability
        // policies, audit trail, logs, migration repository). The marketing
        // module never creates these — the Foundation addon owns them.
        foreach (array(
            'mod_cloudhost247_capabilities', 'mod_cloudhost247_audit_events',
            'mod_cloudhost247_logs', 'mod_cloudhost247_migrations',
        ) as $foundationTable) {
            CH247MarketingFakeSchema::$created[$foundationTable] = true;
        }
        $_POST = array();
        $_GET = array();
        $_REQUEST = array();
        $_SESSION = array();
    }
}
