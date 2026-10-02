<?php
/**
 * Theme test fakes: an in-memory Capsule stand-in for the subset of the query
 * builder the theme repository and the page-builder catalogue reader use, plus
 * readers for assertions. No network, no WHMCS runtime.
 *
 * Same philosophy as tests/ovh/fakes.php and tests/marketing/fakes.php: the
 * tests run the real module classes against a double that fails loudly on any
 * builder method it does not implement, so a query that would silently return
 * "no rows" in production cannot pass here by accident.
 */

namespace {

    final class CH247ThemeFakeDB
    {
        private static $tables = array();
        private static $auto = array();

        public static function reset() { self::$tables = array(); self::$auto = array(); }

        public static function &rowsRef($table)
        {
            $table = (string) $table;
            if (!isset(self::$tables[$table])) { self::$tables[$table] = array(); self::$auto[$table] = 0; }
            return self::$tables[$table];
        }

        public static function nextId($table)
        {
            $table = (string) $table;
            self::$auto[$table] = isset(self::$auto[$table]) ? self::$auto[$table] + 1 : 1;
            return self::$auto[$table];
        }
    }

    final class CH247ThemeFakeSchema
    {
        public static $tables = array();
        public static $columns = array();

        public static function reset() { self::$tables = array(); self::$columns = array(); }

        /** Permissive by default, like the other suite doubles. */
        public function hasTable($name) { return !self::$tables || !empty(self::$tables[$name]); }

        public function hasColumn($table, $column) { return !empty(self::$columns[$table . '.' . $column]); }

        public function create($name, $callback) { CH247ThemeFakeDB::rowsRef($name); }

        public function table($name, $callback) {}
    }

    final class CH247ThemeFakeCollection implements \IteratorAggregate, \Countable
    {
        private $rows;
        public function __construct(array $rows) { $this->rows = $rows; }
        public function getIterator(): \Traversable { return new \ArrayIterator(array_map(function ($r) { return (object) $r; }, $this->rows)); }
        public function count(): int { return count($this->rows); }
        public function all() { return array_map(function ($r) { return (object) $r; }, $this->rows); }
        public function isEmpty() { return count($this->rows) === 0; }
    }

    final class CH247ThemeFakeQuery
    {
        private $table;
        private $alias = '';
        private $wheres = array();
        private $orderBy = array();
        private $columns;
        private $limit;
        private $offset = 0;
        private $joins = array();

        public function __construct($table)
        {
            if (preg_match('/^(\S+)\s+as\s+(\S+)$/i', (string) $table, $m)) { $this->table = $m[1]; $this->alias = $m[2]; }
            else { $this->table = (string) $table; }
        }

        public function join($table, $first, $operator, $second) { return $this->addJoin('inner', $table, $first, $operator, $second); }
        public function leftJoin($table, $first, $operator, $second) { return $this->addJoin('left', $table, $first, $operator, $second); }

        private function addJoin($type, $table, $first, $operator, $second)
        {
            $alias = '';
            if (preg_match('/^(\S+)\s+as\s+(\S+)$/i', (string) $table, $m)) { $table = $m[1]; $alias = $m[2]; }
            $this->joins[] = array('type' => $type, 'table' => (string) $table, 'alias' => $alias, 'first' => $first, 'operator' => $operator, 'second' => $second);
            return $this;
        }

        public function where($column, $operator = null, $value = null) { return $this->addWhere($column, $operator, $value); }

        private function addWhere($column, $operator, $value)
        {
            if ($operator === null) { $operator = '='; }
            elseif ($value === null && !in_array($operator, array('=', '<', '>', '<=', '>=', '!=', '<>'), true)) { $value = $operator; $operator = '='; }
            $this->wheres[] = array($column, $operator, $value);
            return $this;
        }

        public function whereIn($column, array $values) { $this->wheres[] = array($column, 'in', $values); return $this; }
        public function whereNotNull($column) { $this->wheres[] = array($column, '!=', null); return $this; }

        public function select()
        {
            $columns = func_get_args();
            if (count($columns) === 1 && is_array($columns[0])) { $columns = $columns[0]; }
            $this->columns = $columns;
            return $this;
        }

        public function orderBy($column, $direction = 'asc') { $this->orderBy[] = array($column, strtolower((string) $direction) === 'desc' ? 'desc' : 'asc'); return $this; }
        public function limit($n) { $this->limit = (int) $n; return $this; }
        public function offset($n) { $this->offset = (int) $n; return $this; }
        public function take($n) { return $this->limit($n); }
        public function skip($n) { return $this->offset($n); }

        public function __call($name, $arguments)
        {
            throw new \RuntimeException('The theme fake DB does not implement query builder method: ' . $name);
        }

        private function joinedRows()
        {
            $rows = CH247ThemeFakeDB::rowsRef($this->table);
            $base = array();
            foreach ($rows as $row) { $base[] = $this->flatten($row, $this->alias); }
            foreach ($this->joins as $join) {
                $foreign = array();
                foreach (CH247ThemeFakeDB::rowsRef($join['table']) as $row) { $foreign[] = $this->flatten($row, $join['alias']); }
                $merged = array();
                foreach ($base as $row) {
                    $matched = false;
                    foreach ($foreign as $candidate) {
                        if ($this->joinMatches($row, $candidate, $join)) { $merged[] = array_merge($candidate, array_diff_key($row, $candidate)); $matched = true; }
                    }
                    if (!$matched && $join['type'] === 'left') { $merged[] = $row; }
                }
                $base = $merged;
            }
            return $base;
        }

        private function flatten(array $row, $alias)
        {
            if (!is_array($row)) { return array(); }
            if ($alias === '') { return $row; }
            $out = array();
            foreach ($row as $key => $value) { $out[$alias . '.' . $key] = $value; }
            foreach ($row as $key => $value) { $out[$key] = $value; }
            return $out;
        }

        private function joinMatches(array $row, array $foreign, array $join)
        {
            $left = $this->value($foreign, $join['first']);
            $right = $this->value($row, $join['second']);
            if ($join['operator'] === '=') { return $left == $right; }
            if ($join['operator'] === '!=') { return $left != $right; }
            return false;
        }

        private function value(array $row, $column)
        {
            $column = (string) $column;
            if (array_key_exists($column, $row)) { return $row[$column]; }
            $parts = explode('.', $column);
            $short = end($parts);
            if (array_key_exists($short, $row)) { return $row[$short]; }
            return null;
        }

        private function matches(array $row)
        {
            foreach ($this->wheres as $where) {
                $value = $this->value($row, $where[0]);
                $expected = $where[2];
                switch ($where[1]) {
                    case '=': if ($value != $expected) { return false; } break;
                    case '!=': if ($value == $expected) { return false; } break;
                    case '<': if (!($value < $expected)) { return false; } break;
                    case '>': if (!($value > $expected)) { return false; } break;
                    case '<=': if (!($value <= $expected)) { return false; } break;
                    case '>=': if (!($value >= $expected)) { return false; } break;
                    case 'in': if (!in_array($value, $expected, false)) { return false; } break;
                    default: throw new \RuntimeException('The theme fake DB does not implement operator: ' . $where[1]);
                }
            }
            return true;
        }

        private function rows()
        {
            $out = array();
            foreach ($this->joinedRows() as $row) { if ($this->matches($row)) { $out[] = $row; } }
            foreach (array_reverse($this->orderBy) as $order) {
                usort($out, function ($a, $b) use ($order) {
                    $av = $this->value($a, $order[0]);
                    $bv = $this->value($b, $order[0]);
                    if ($av == $bv) { return 0; }
                    $cmp = ($av < $bv) ? -1 : 1;
                    return $order[1] === 'desc' ? -$cmp : $cmp;
                });
            }
            if ($this->offset > 0 || $this->limit !== null) { $out = array_slice($out, $this->offset, $this->limit); }
            return $out;
        }

        public function first()
        {
            $rows = $this->rows();
            if (!$rows) { return null; }
            return (object) $this->project($rows[0]);
        }

        public function get() { return new CH247ThemeFakeCollection(array_map(array($this, 'project'), $this->rows())); }
        public function count() { return count($this->rows()); }
        public function exists() { return count($this->rows()) > 0; }

        private function project(array $row)
        {
            $row = $this->unflatten($row);
            if ($this->columns === null) { return $row; }
            $keep = array();
            foreach ($this->columns as $column) {
                $parts = explode('.', $column);
                $short = end($parts);
                if (array_key_exists($short, $row)) { $keep[$short] = $row[$short]; }
            }
            return $keep;
        }

        /** Strip the "alias." prefixes used internally for joining. */
        private function unflatten(array $row)
        {
            $out = array();
            foreach ($row as $key => $value) {
                $parts = explode('.', $key, 2);
                $short = count($parts) === 2 ? $parts[1] : $parts[0];
                if (!array_key_exists($short, $out)) { $out[$short] = $value; }
            }
            return $out;
        }

        public function insert(array $data)
        {
            if (!isset($data['id'])) { $data['id'] = CH247ThemeFakeDB::nextId($this->table); }
            $rows = &CH247ThemeFakeDB::rowsRef($this->table);
            $rows[] = $data;
            return true;
        }

        public function insertGetId(array $data)
        {
            $this->insert($data);
            $rows = &CH247ThemeFakeDB::rowsRef($this->table);
            $last = end($rows);
            return $last['id'];
        }

        public function update(array $attributes)
        {
            $rows = &CH247ThemeFakeDB::rowsRef($this->table);
            $affected = 0;
            foreach ($rows as $i => $row) {
                if ($this->matches($this->flatten($row, $this->alias))) { $rows[$i] = array_merge($row, $attributes); $affected++; }
            }
            return $affected;
        }

        public function updateOrInsert(array $attributes, array $values)
        {
            $rows = &CH247ThemeFakeDB::rowsRef($this->table);
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
            $rows = &CH247ThemeFakeDB::rowsRef($this->table);
            $kept = array(); $removed = 0;
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
            public static function table($name) { return new \CH247ThemeFakeQuery($name); }
            public static function schema() { return new \CH247ThemeFakeSchema(); }
        }
    }
}

namespace {

    function ch247_theme_rows($table)
    {
        $rows = CH247ThemeFakeDB::rowsRef((string) $table);
        $out = array();
        foreach ($rows as $row) { $out[] = (object) $row; }
        return $out;
    }

    function ch247_theme_fresh()
    {
        CH247ThemeFakeDB::reset();
        CH247ThemeFakeSchema::reset();
        foreach (array(
            'mod_cloudhost247_theme_settings', 'mod_cloudhost247_theme_content',
            'mod_cloudhost247_theme_translations', 'mod_cloudhost247_audit_events',
            'tblproducts', 'tblproductgroups', 'tblpricing', 'tblcurrencies',
        ) as $table) { CH247ThemeFakeDB::rowsRef($table); }
        $_POST = array();
        $_GET = array();
        $_SESSION = array();
    }

    /** Insert a theme content row the way saveContent() would. */
    function ch247_theme_seed_content($id, $type, $slug, $title, $sortOrder, $published, array $payload = array())
    {
        $rows = &CH247ThemeFakeDB::rowsRef('mod_cloudhost247_theme_content');
        $rows[] = array_merge(array(
            'id' => (int) $id, 'content_type' => (string) $type, 'slug' => (string) $slug, 'title' => (string) $title,
            'payload_json' => json_encode($payload), 'published' => $published ? 1 : 0, 'sort_order' => (int) $sortOrder,
            'created_at' => '2026-01-01 00:00:00', 'updated_at' => '2026-01-01 00:00:00',
        ));
    }
}
