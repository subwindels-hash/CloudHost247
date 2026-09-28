<?php
/**
 * Test doubles for the Website Builder suite.
 *
 * WHMCS is replaced, the builder is not. The Capsule double is backed by a
 * real SQLite database through PDO, so the module's own migration creates the
 * tables and the repositories execute their real queries -- filters, ordering,
 * pagination, aggregates and all. Only the platform around the builder is
 * simulated: the admin session, the CSRF check, the audit trail and localAPI.
 */

namespace CloudHost247\Foundation\Security {
    class AdminGuard
    {
        public static $adminId = 7;
        public static $denied = array();
        public static $tokenValid = true;
        public static $calls = array();

        public static function reset()
        {
            self::$adminId = 7;
            self::$denied = array();
            self::$tokenValid = true;
            self::$calls = array();
        }

        public static function requireAdmin()
        {
            self::$calls[] = 'requireAdmin';
            if (!self::$adminId) { throw new \RuntimeException('An authenticated WHMCS administrator is required.'); }
            return (int) self::$adminId;
        }

        public static function requirePostToken()
        {
            self::$calls[] = 'requirePostToken';
            if (!self::$tokenValid) { throw new \RuntimeException('Invalid or expired CSRF token.'); }
            return true;
        }

        public static function requireCapability($module, $capability)
        {
            self::$calls[] = 'require:' . $capability;
            if (in_array($capability, self::$denied, true)) {
                throw new \RuntimeException('Your WHMCS administrator role lacks the required CloudHost247 capability.');
            }
            return true;
        }

        public static function capability($module, $capability)
        {
            return !in_array($capability, self::$denied, true);
        }
    }
}

namespace CloudHost247\Foundation\Support {
    class Logger
    {
        public static $lines = array();

        public static function write($module, $level, $event, array $context = array(), $correlationId = null)
        {
            self::$lines[] = array('module' => $module, 'level' => $level, 'event' => $event, 'context' => $context);
            return true;
        }

        public static function correlationId() { return 'test-correlation'; }
    }

    class AuditLogger
    {
        public static $entries = array();

        public static function record($module, $action, $resourceType, $resourceId, $before, $after,
                                      $result = 'success', $failureReason = null, $adminId = null)
        {
            self::$entries[] = array(
                'module' => $module, 'action' => $action, 'resource_type' => $resourceType,
                'resource_id' => $resourceId, 'result' => $result, 'admin_id' => $adminId,
            );
            return true;
        }

        public static function reset() { self::$entries = array(); }
    }

    class SafeError
    {
        public static function from(\Throwable $error, $module, $event, $customerMessage = 'The requested operation could not be completed safely.')
        {
            Logger::write($module, 'error', $event, array('class' => get_class($error)));
            return array(
                'message' => $customerMessage,
                'correlation_id' => 'test-correlation',
                'display' => $customerMessage . ' Reference: test-correlation',
            );
        }
    }
}

namespace WHMCS\Database {

    /**
     * Minimal Laravel-style query builder over PDO SQLite.
     *
     * Only the surface the builder actually uses is implemented, and it is
     * implemented honestly: where clauses bind parameters, ordering and limits
     * reach SQL, and aggregates are computed by the database rather than in
     * PHP. If a repository writes a query this cannot express, the test fails
     * loudly instead of silently passing.
     */
    class FakeQuery
    {
        private $pdo;
        private $table;
        private $wheres = array();
        private $bindings = array();
        private $orders = array();
        private $limit = null;
        private $offset = null;

        public function __construct(\PDO $pdo, $table)
        {
            $this->pdo = $pdo;
            $this->table = $table;
        }

        public function where($column, $operator = null, $value = null)
        {
            if ($column instanceof \Closure) {
                $group = new self($this->pdo, $this->table);
                $column($group);
                $clause = $group->whereClause(true);
                if ($clause !== '') {
                    $this->wheres[] = array('AND', '(' . $clause . ')');
                    foreach ($group->bindings() as $binding) { $this->bindings[] = $binding; }
                }
                return $this;
            }
            if ($value === null && $operator !== null) { $value = $operator; $operator = '='; }
            if ($operator === null) { $operator = '='; }
            $this->wheres[] = array('AND', $this->quote($column) . ' ' . $operator . ' ?');
            $this->bindings[] = $this->normalize($value);
            return $this;
        }

        public function orWhere($column, $operator = null, $value = null)
        {
            if ($value === null && $operator !== null) { $value = $operator; $operator = '='; }
            if ($operator === null) { $operator = '='; }
            $this->wheres[] = array('OR', $this->quote($column) . ' ' . $operator . ' ?');
            $this->bindings[] = $this->normalize($value);
            return $this;
        }

        public function whereIn($column, array $values)
        {
            if (!$values) { $this->wheres[] = array('AND', '1 = 0'); return $this; }
            $placeholders = implode(', ', array_fill(0, count($values), '?'));
            $this->wheres[] = array('AND', $this->quote($column) . ' IN (' . $placeholders . ')');
            foreach ($values as $value) { $this->bindings[] = $this->normalize($value); }
            return $this;
        }

        public function whereNotNull($column)
        {
            $this->wheres[] = array('AND', $this->quote($column) . ' IS NOT NULL');
            return $this;
        }

        public function whereNull($column)
        {
            $this->wheres[] = array('AND', $this->quote($column) . ' IS NULL');
            return $this;
        }

        public function orderBy($column, $direction = 'asc')
        {
            $this->orders[] = $this->quote($column) . ' ' . (strtolower($direction) === 'desc' ? 'DESC' : 'ASC');
            return $this;
        }

        public function limit($count) { $this->limit = (int) $count; return $this; }

        public function offset($count) { $this->offset = (int) $count; return $this; }

        public function get()
        {
            $statement = $this->run('SELECT * FROM ' . $this->quote($this->table) . $this->tail());
            $rows = array();
            foreach ($statement->fetchAll(\PDO::FETCH_ASSOC) as $row) { $rows[] = (object) $row; }
            return $rows;
        }

        public function first()
        {
            $this->limit = 1;
            $rows = $this->get();
            return $rows ? $rows[0] : null;
        }

        public function count()
        {
            $statement = $this->run('SELECT COUNT(*) AS aggregate FROM ' . $this->quote($this->table) . $this->whereSql());
            $row = $statement->fetch(\PDO::FETCH_ASSOC);
            return (int) $row['aggregate'];
        }

        public function exists() { return $this->count() > 0; }

        public function max($column)
        {
            $statement = $this->run('SELECT MAX(' . $this->quote($column) . ') AS aggregate FROM '
                . $this->quote($this->table) . $this->whereSql());
            $row = $statement->fetch(\PDO::FETCH_ASSOC);
            return $row['aggregate'];
        }

        public function sum($column)
        {
            $statement = $this->run('SELECT COALESCE(SUM(' . $this->quote($column) . '), 0) AS aggregate FROM '
                . $this->quote($this->table) . $this->whereSql());
            $row = $statement->fetch(\PDO::FETCH_ASSOC);
            return $row['aggregate'];
        }

        public function insert(array $values)
        {
            $columns = array();
            $placeholders = array();
            $bindings = array();
            foreach ($values as $column => $value) {
                $columns[] = $this->quote($column);
                $placeholders[] = '?';
                $bindings[] = $this->normalize($value);
            }
            $sql = 'INSERT INTO ' . $this->quote($this->table) . ' (' . implode(', ', $columns) . ') VALUES ('
                . implode(', ', $placeholders) . ')';
            $statement = $this->pdo->prepare($sql);
            $statement->execute($bindings);
            return true;
        }

        public function insertGetId(array $values)
        {
            $this->insert($values);
            return (int) $this->pdo->lastInsertId();
        }

        public function update(array $values)
        {
            if (!$values) { return 0; }
            $assignments = array();
            $bindings = array();
            foreach ($values as $column => $value) {
                $assignments[] = $this->quote($column) . ' = ?';
                $bindings[] = $this->normalize($value);
            }
            $sql = 'UPDATE ' . $this->quote($this->table) . ' SET ' . implode(', ', $assignments) . $this->whereSql();
            $statement = $this->pdo->prepare($sql);
            $statement->execute(array_merge($bindings, $this->bindings));
            return $statement->rowCount();
        }

        public function updateOrInsert(array $attributes, array $values = array())
        {
            $probe = new self($this->pdo, $this->table);
            foreach ($attributes as $column => $value) { $probe->where($column, $value); }
            if ($probe->exists()) {
                $update = new self($this->pdo, $this->table);
                foreach ($attributes as $column => $value) { $update->where($column, $value); }
                return $update->update($values) > 0;
            }
            return $this->insert(array_merge($attributes, $values));
        }

        public function delete()
        {
            $statement = $this->run('DELETE FROM ' . $this->quote($this->table) . $this->whereSql());
            return $statement->rowCount();
        }

        public function bindings() { return $this->bindings; }

        public function whereClause($inner = false)
        {
            $sql = '';
            foreach ($this->wheres as $index => $where) {
                $sql .= ($index === 0 ? '' : ' ' . $where[0] . ' ') . $where[1];
            }
            return $sql;
        }

        private function whereSql()
        {
            $clause = $this->whereClause();
            return $clause === '' ? '' : ' WHERE ' . $clause;
        }

        private function tail()
        {
            $sql = $this->whereSql();
            if ($this->orders) { $sql .= ' ORDER BY ' . implode(', ', $this->orders); }
            if ($this->limit !== null) { $sql .= ' LIMIT ' . (int) $this->limit; }
            if ($this->offset !== null) { $sql .= ' OFFSET ' . (int) $this->offset; }
            return $sql;
        }

        private function run($sql)
        {
            $statement = $this->pdo->prepare($sql);
            $statement->execute($this->bindings);
            return $statement;
        }

        private function normalize($value)
        {
            if (is_bool($value)) { return $value ? 1 : 0; }
            return $value;
        }

        private function quote($identifier)
        {
            return '"' . str_replace('"', '', (string) $identifier) . '"';
        }
    }

    /** Blueprint column with the fluent modifiers the migration uses. */
    class FakeColumn
    {
        public $name;
        public $type;
        public $nullable = false;
        public $default = null;
        public $hasDefault = false;
        public $autoIncrement = false;

        public function __construct($name, $type, $autoIncrement = false)
        {
            $this->name = $name;
            $this->type = $type;
            $this->autoIncrement = $autoIncrement;
        }

        public function nullable($value = true) { $this->nullable = (bool) $value; return $this; }

        public function default($value) { $this->default = $value; $this->hasDefault = true; return $this; }

        public function unique($name = null) { return $this; }

        public function index($name = null) { return $this; }

        public function unsigned() { return $this; }
    }

    class FakeBlueprint
    {
        public $columns = array();

        private function add($name, $type, $autoIncrement = false)
        {
            $column = new FakeColumn($name, $type, $autoIncrement);
            $this->columns[] = $column;
            return $column;
        }

        public function increments($name) { return $this->add($name, 'INTEGER', true); }
        public function bigIncrements($name) { return $this->add($name, 'INTEGER', true); }
        public function string($name, $length = 255) { return $this->add($name, 'TEXT'); }
        public function text($name) { return $this->add($name, 'TEXT'); }
        public function longText($name) { return $this->add($name, 'TEXT'); }
        public function mediumText($name) { return $this->add($name, 'TEXT'); }
        public function integer($name) { return $this->add($name, 'INTEGER'); }
        public function unsignedInteger($name) { return $this->add($name, 'INTEGER'); }
        public function bigInteger($name) { return $this->add($name, 'INTEGER'); }
        public function unsignedBigInteger($name) { return $this->add($name, 'INTEGER'); }
        public function boolean($name) { return $this->add($name, 'INTEGER'); }
        public function decimal($name, $precision = 8, $scale = 2) { return $this->add($name, 'REAL'); }
        public function dateTime($name) { return $this->add($name, 'TEXT'); }
        public function timestamp($name) { return $this->add($name, 'TEXT'); }
        public function date($name) { return $this->add($name, 'TEXT'); }
        public function unique($columns, $name = null) { return $this; }
        public function index($columns, $name = null) { return $this; }
    }

    class FakeSchema
    {
        private $pdo;

        public function __construct(\PDO $pdo) { $this->pdo = $pdo; }

        public function hasTable($table)
        {
            $statement = $this->pdo->prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?");
            $statement->execute(array($table));
            return (int) $statement->fetchColumn() > 0;
        }

        public function hasColumn($table, $column)
        {
            foreach ($this->pdo->query('PRAGMA table_info("' . str_replace('"', '', $table) . '")') as $row) {
                if (isset($row['name']) && $row['name'] === $column) { return true; }
            }
            return false;
        }

        public function create($table, \Closure $definition)
        {
            $blueprint = new FakeBlueprint();
            $definition($blueprint);
            $parts = array();
            foreach ($blueprint->columns as $column) {
                $sql = '"' . $column->name . '" ' . $column->type;
                if ($column->autoIncrement) {
                    $sql .= ' PRIMARY KEY AUTOINCREMENT';
                } else {
                    if (!$column->nullable) { $sql .= ' NOT NULL'; }
                    if ($column->hasDefault) {
                        $default = $column->default;
                        if (is_bool($default)) { $default = $default ? 1 : 0; }
                        $sql .= ' DEFAULT ' . (is_numeric($default) ? $default : $this->pdo->quote((string) $default));
                    } elseif (!$column->nullable) {
                        $sql .= ' DEFAULT ' . ($column->type === 'INTEGER' || $column->type === 'REAL' ? '0' : "''");
                    }
                }
                $parts[] = $sql;
            }
            $this->pdo->exec('CREATE TABLE "' . str_replace('"', '', $table) . '" (' . implode(', ', $parts) . ')');
            return true;
        }

        public function drop($table)
        {
            $this->pdo->exec('DROP TABLE IF EXISTS "' . str_replace('"', '', $table) . '"');
            return true;
        }
    }

    class FakeConnection
    {
        private $pdo;

        public function __construct(\PDO $pdo) { $this->pdo = $pdo; }

        public function transaction(\Closure $work) { return $work(); }

        public function getPdo() { return $this->pdo; }
    }

    /** Static entry point matching the WHMCS Capsule facade. */
    class Capsule
    {
        private static $pdo = null;

        public static function boot($path = ':memory:')
        {
            self::$pdo = new \PDO('sqlite:' . $path);
            self::$pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
            self::$pdo->exec('PRAGMA foreign_keys = ON');
            return self::$pdo;
        }

        public static function pdo()
        {
            if (self::$pdo === null) { self::boot(); }
            return self::$pdo;
        }

        public static function reset() { self::$pdo = null; }

        public static function table($table) { return new FakeQuery(self::pdo(), $table); }

        public static function schema() { return new FakeSchema(self::pdo()); }

        public static function connection() { return new FakeConnection(self::pdo()); }
    }
}

namespace {
    if (!function_exists('generate_token')) {
        function generate_token($type = 'plain') { return 'test-csrf-token'; }
    }

    /** Recording localAPI double for the form notification tests. */
    class FakeLocalApi
    {
        public static $calls = array();
        public static $responses = array();

        public static function reset()
        {
            self::$calls = array();
            self::$responses = array();
        }

        public static function handler()
        {
            return function ($action, array $params) {
                FakeLocalApi::$calls[] = array('action' => $action, 'params' => $params);
                if (isset(FakeLocalApi::$responses[$action])) { return FakeLocalApi::$responses[$action]; }
                return array('result' => 'success');
            };
        }
    }
}
