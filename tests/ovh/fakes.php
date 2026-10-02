<?php
/**
 * OVH test fakes: an in-memory Capsule stand-in with the join/alias support the
 * OVH queries use, plus readers for assertions. No network, no WHMCS runtime.
 *
 * Same philosophy as tests/broker/fakes.php and tests/marketing/fakes.php: the
 * tests run the real module classes against a double that behaves like the
 * subset of the query builder those classes touch — and fails loudly on anything
 * it does not implement, so an unimplemented builder method cannot silently
 * return "no rows" and turn a broken query into a passing test.
 */

namespace {

    final class CH247OvhFakeDB
    {
        private static $tables = array();
        private static $auto = array();

        public static function reset() { self::$tables = array(); self::$auto = array(); }

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

    final class CH247OvhFakeSchema
    {
        public static $columns = array();

        public static function reset() { self::$columns = array(); }

        public function hasTable($name) { return true; }

        public function create($name, $callback) { CH247OvhFakeDB::rowsRef($name); }

        public function hasColumn($table, $column) { return !empty(self::$columns[$table . '.' . $column]); }

        public function table($table, $callback) {}
    }

    final class CH247OvhFakeCollection implements \IteratorAggregate, \Countable
    {
        private $rows;
        public function __construct(array $rows) { $this->rows = $rows; }
        public function getIterator() { return new \ArrayIterator(array_map(function ($r) { return (object) $r; }, $this->rows)); }
        public function count() { return count($this->rows); }
        public function all() { return array_map(function ($r) { return (object) $r; }, $this->rows); }
        public function isEmpty() { return count($this->rows) === 0; }
    }

    final class CH247OvhFakeQuery
    {
        private $table;
        private $alias;
        private $wheres = array();
        private $joins = array();
        private $orderBy = array();
        private $limit = null;
        private $offset = 0;
        private $columns = null;

        public function __construct($table)
        {
            $table = trim((string) $table);
            if (preg_match('/^(\S+)\s+as\s+(\S+)$/i', $table, $m)) { $this->table = $m[1]; $this->alias = $m[2]; }
            else { $this->table = $table; $this->alias = $table; }
        }

        public function join($table, $first, $operator, $second) { return $this->addJoin('inner', $table, $first, $operator, $second); }
        public function leftJoin($table, $first, $operator, $second) { return $this->addJoin('left', $table, $first, $operator, $second); }

        private function addJoin($type, $table, $first, $operator, $second)
        {
            $alias = $table;
            if (preg_match('/^(\S+)\s+as\s+(\S+)$/i', trim((string) $table), $m)) { $table = $m[1]; $alias = $m[2]; }
            $this->joins[] = array('type' => $type, 'table' => $table, 'alias' => $alias, 'first' => $first, 'operator' => $operator, 'second' => $second);
            return $this;
        }

        public function where($column, $operator = null, $value = null) { return $this->addWhere($column, $operator, $value); }

        private function addWhere($column, $operator, $value)
        {
            if ($value === null && $operator !== null) { $value = $operator; $operator = '='; }
            $this->wheres[] = array($column, $operator ?: '=', $value);
            return $this;
        }

        public function whereIn($column, array $values) { $this->wheres[] = array($column, 'in', $values); return $this; }
        public function whereNotNull($column) { $this->wheres[] = array($column, '!=', null); return $this; }
        public function whereNull($column) { $this->wheres[] = array($column, '=', null); return $this; }

        public function select()
        {
            $args = func_get_args();
            if (count($args) === 1 && is_array($args[0])) { $args = $args[0]; }
            $this->columns = array_map('strval', $args);
            return $this;
        }

        public function orderBy($column, $direction = 'asc') { $this->orderBy[] = array($column, strtolower((string) $direction) === 'desc' ? 'desc' : 'asc'); return $this; }
        public function limit($n) { $this->limit = (int) $n; return $this; }
        public function offset($n) { $this->offset = (int) $n; return $this; }
        public function take($n) { return $this->limit($n); }
        public function skip($n) { return $this->offset($n); }

        /** Fails loudly rather than pretending: a missing builder method is a test bug. */
        public function __call($name, $arguments)
        {
            throw new \RuntimeException('CH247OvhFakeQuery does not implement ' . $name . '(); add it before relying on it.');
        }

        private function joinedRows()
        {
            $rows = array();
            foreach (CH247OvhFakeDB::rowsRef($this->table) as $row) {
                $rows[] = $this->flatten($row, $this->alias);
            }
            foreach ($this->joins as $join) {
                $out = array();
                foreach ($rows as $row) {
                    $matched = false;
                    foreach (CH247OvhFakeDB::rowsRef($join['table']) as $candidate) {
                        $foreign = $this->flatten($candidate, $join['alias']);
                        // Qualified keys always merge; an unqualified duplicate stays
                        // the base table's value, the way an ambiguous real column is
                        // only meaningful when the query qualifies it.
                        if ($this->joinMatches($row, $foreign, $join)) { $out[] = array_merge($row, array_diff_key($foreign, $row)); $matched = true; }
                    }
                    if (!$matched && $join['type'] === 'left') { $out[] = $row; }
                }
                $rows = $out;
            }
            return $rows;
        }

        private function flatten(array $row, $alias)
        {
            $flat = array();
            foreach ($row as $key => $value) {
                $flat[$key] = $value;
                $flat[$alias . '.' . $key] = $value;
                $this->aliasMap[$alias . '.' . $key] = $key;
            }
            return $flat;
        }

        private $aliasMap = array();

        private function joinMatches(array $row, array $foreign, array $join)
        {
            // Laravel reads `join($table, $first, $op, $second)` with $first on the
            // joined table and $second on the base — the reverse of what it looks
            // like. Getting this backwards made every join fall through to the
            // short-key fallback and "match" on an unrelated column.
            $left = $this->value($foreign, $join['first']);
            $right = $this->value($row, $join['second']);
            if ($join['operator'] === '=') { return $left == $right; }
            throw new \RuntimeException('CH247OvhFakeQuery only supports "=" joins.');
        }

        private function value(array $row, $column)
        {
            if (array_key_exists($column, $row)) { return $row[$column]; }
            $parts = explode('.', (string) $column);
            $short = end($parts);
            return array_key_exists($short, $row) ? $row[$short] : null;
        }

        private function matches(array $row)
        {
            foreach ($this->wheres as $where) {
                $actual = $this->value($row, $where[0]);
                $operator = $where[1];
                $expected = $where[2];
                $ok = false;
                switch ($operator) {
                    case '=': $ok = ($actual == $expected); break;
                    case '!=': $ok = ($actual != $expected); break;
                    case '>': $ok = ($actual > $expected); break;
                    case '>=': $ok = ($actual >= $expected); break;
                    case '<': $ok = ($actual < $expected); break;
                    case '<=': $ok = ($actual <= $expected); break;
                    case 'in': $ok = in_array($actual, (array) $expected); break;
                    default: throw new \RuntimeException('CH247OvhFakeQuery does not implement operator ' . $operator . '.');
                }
                if (!$ok) { return false; }
            }
            return true;
        }

        private function rows()
        {
            $out = array();
            foreach ($this->joinedRows() as $row) {
                if ($this->matches($row)) { $out[] = $row; }
            }
            foreach (array_reverse($this->orderBy) as $order) {
                usort($out, function ($a, $b) use ($order) {
                    $av = $this->value($a, $order[0]);
                    $bv = $this->value($b, $order[0]);
                    if ($av == $bv) { return 0; }
                    $cmp = ($av < $bv) ? -1 : 1;
                    return $order[1] === 'desc' ? -$cmp : $cmp;
                });
            }
            if ($this->offset > 0 || $this->limit !== null) {
                $out = array_slice($out, $this->offset, $this->limit);
            }
            return $out;
        }

        public function first()
        {
            $rows = $this->rows();
            if (!$rows) { return null; }
            return (object) $this->project($rows[0]);
        }

        public function get() { return new CH247OvhFakeCollection(array_map(array($this, 'project'), $this->rows())); }
        public function count() { return count($this->rows()); }
        public function exists() { return count($this->rows()) > 0; }

        private function project(array $row)
        {
            if ($this->columns === null) { return $row; }
            $keep = array();
            foreach ($this->columns as $column) {
                // `m.*` — every column of one table/alias.
                if (preg_match('/^(\S+)\.\*$/', $column, $m)) {
                    foreach ($row as $key => $value) {
                        if (strpos($key, $m[1] . '.') === 0) { $keep[substr($key, strlen($m[1]) + 1)] = $value; }
                    }
                    continue;
                }
                // `o.optionname as suboption_name`
                if (preg_match('/^(.+?)\s+as\s+(\S+)$/i', $column, $m)) {
                    $keep[$m[2]] = $this->value($row, trim($m[1]));
                    continue;
                }
                $parts = explode('.', $column);
                $short = end($parts);
                $value = $this->value($row, $column);
                if ($value !== null || array_key_exists($short, $row)) { $keep[$short] = $value; }
            }
            return $keep;
        }

        public function insert(array $data)
        {
            if (!isset($data['id'])) { $data['id'] = CH247OvhFakeDB::nextId($this->table); }
            $rows = &CH247OvhFakeDB::rowsRef($this->table);
            $rows[] = $data;
            return true;
        }

        public function insertGetId(array $data)
        {
            $this->insert($data);
            $rows = &CH247OvhFakeDB::rowsRef($this->table);
            $last = end($rows);
            return $last['id'];
        }

        public function update(array $attributes)
        {
            $rows = &CH247OvhFakeDB::rowsRef($this->table);
            $affected = 0;
            foreach ($rows as $i => $row) {
                if ($this->matches($this->flatten($row, $this->alias))) { $rows[$i] = array_merge($row, $attributes); $affected++; }
            }
            return $affected;
        }

        public function updateOrInsert(array $attributes, array $values)
        {
            $rows = &CH247OvhFakeDB::rowsRef($this->table);
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
            $rows = &CH247OvhFakeDB::rowsRef($this->table);
            $kept = array();
            $removed = 0;
            foreach ($rows as $row) {
                if ($this->matches($this->flatten($row, $this->alias))) { $removed++; } else { $kept[] = $row; }
            }
            $rows = $kept;
            return $removed;
        }
    }
}

namespace WHMCS\Database {

    if (!class_exists('WHMCS\Database\Capsule', false)) {
        class Capsule
        {
            public static function table($name) { return new \CH247OvhFakeQuery($name); }
            public static function schema() { return new \CH247OvhFakeSchema(); }
            public static function connection() { return new \CH247OvhFakeConnection(); }
        }

        class FakeConnection
        {
        }
    }
}

namespace {

    class CH247OvhFakeConnection
    {
        public function transaction($callback) { return $callback(); }
    }

    function ch247_ovh_rows($table)
    {
        $rows = CH247OvhFakeDB::rowsRef((string) $table);
        $out = array();
        foreach ($rows as $row) { $out[] = (object) $row; }
        return $out;
    }

    function ch247_ovh_fresh()
    {
        CH247OvhFakeDB::reset();
        CH247OvhFakeSchema::reset();
        foreach (array(
            'mod_cloudhost247_audit_events', 'mod_cloudhost247_logs', 'mod_cloudhost247_migrations',
            'mod_cloudhost247_capabilities',
        ) as $foundation) { CH247OvhFakeDB::rowsRef($foundation); }
        // Columns the module guards on but the double has no schema for.
        foreach (array('mod_cloudhost247_ovh_endpoints.integration_key', 'mod_cloudhost247_ovh_option_mappings.verified', 'mod_cloudhost247_hosting_products.specification_sources_json') as $column) {
            CH247OvhFakeSchema::$columns[$column] = true;
        }
        $_POST = array();
        $_GET = array();
        $_SESSION = array();
    }
}
