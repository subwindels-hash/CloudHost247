<?php
/**
 * Database Helper
 *
 * Thin, dependency-light wrapper around the WHMCS Illuminate (Capsule)
 * connection. The legacy WHMCS query helpers (select_query/full_query/
 * mysql_fetch_assoc) were deprecated in WHMCS 7 and removed in WHMCS 8, so
 * every data access in this module funnels through here.
 *
 * All methods use bound parameters - no string interpolation of user input.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

use WHMCS\Database\Capsule;

class Database
{
    /**
     * Fluent query builder for a table.
     *
     * @return \Illuminate\Database\Query\Builder
     */
    public static function table(string $table)
    {
        return Capsule::table($table);
    }

    /**
     * Run a raw SELECT with bound parameters and return plain arrays.
     *
     * Example: Database::raw('SELECT * FROM x WHERE id = ?', [$id])
     */
    public static function raw(string $sql, array $bindings = []): array
    {
        try {
            $rows = Capsule::select($sql, array_values($bindings));
        } catch (\Exception $e) {
            Logger::error('Database select failed: ' . $e->getMessage(), ['sql' => $sql]);
            return [];
        }

        return array_map(static function ($row) {
            return json_decode(json_encode($row), true);
        }, $rows);
    }

    /**
     * Run a raw statement (INSERT/UPDATE/DELETE/DDL) with bound parameters.
     *
     * @return int Affected rows (0 on failure)
     */
    public static function statement(string $sql, array $bindings = []): int
    {
        try {
            if ($bindings) {
                return (int) Capsule::connection()->affectingStatement($sql, array_values($bindings));
            }

            Capsule::connection()->statement($sql);
            return 0;
        } catch (\Exception $e) {
            Logger::error('Database statement failed: ' . $e->getMessage(), ['sql' => $sql]);
            return 0;
        }
    }

    /**
     * Insert a row and return the new primary key (0 on failure).
     */
    public static function insert(string $table, array $data): int
    {
        try {
            return (int) Capsule::table($table)->insertGetId($data);
        } catch (\Exception $e) {
            Logger::error('Database insert failed: ' . $e->getMessage(), ['table' => $table]);
            return 0;
        }
    }

    /**
     * Update rows matching $where. Returns affected row count.
     */
    public static function update(string $table, array $data, array $where): int
    {
        try {
            return (int) Capsule::table($table)->where($where)->update($data);
        } catch (\Exception $e) {
            Logger::error('Database update failed: ' . $e->getMessage(), ['table' => $table]);
            return 0;
        }
    }

    /**
     * Select rows as arrays.
     *
     * @param string|array $fields
     */
    public static function select(
        string $table,
        $fields = '*',
        array $where = [],
        string $orderBy = 'id',
        string $orderDir = 'ASC',
        ?int $limit = null,
        int $offset = 0
    ): array {
        try {
            $query = Capsule::table($table);

            if ($fields !== '*' && $fields !== '') {
                $query->select(is_array($fields) ? $fields : array_map('trim', explode(',', $fields)));
            }

            if ($where) {
                $query->where($where);
            }

            if ($orderBy !== '') {
                $query->orderBy($orderBy, strtoupper($orderDir) === 'DESC' ? 'desc' : 'asc');
            }

            if ($limit !== null) {
                $query->limit(max(1, $limit));
            }

            if ($offset > 0) {
                $query->offset($offset);
            }

            return array_map(static function ($row) {
                return json_decode(json_encode($row), true);
            }, $query->get()->all());
        } catch (\Exception $e) {
            Logger::error('Database select failed: ' . $e->getMessage(), ['table' => $table]);
            return [];
        }
    }

    /**
     * Fetch a single row or null.
     *
     * @param string|array $fields
     */
    public static function row(string $table, $fields = '*', array $where = [], string $orderBy = 'id', string $orderDir = 'ASC'): ?array
    {
        $rows = self::select($table, $fields, $where, $orderBy, $orderDir, 1);

        return $rows ? $rows[0] : null;
    }

    /**
     * Fetch a single column value from the first matching row.
     *
     * @return mixed|null
     */
    public static function value(string $table, string $column, array $where = [])
    {
        $row = self::row($table, $column, $where);

        return $row[$column] ?? null;
    }

    public static function count(string $table, array $where = []): int
    {
        try {
            $query = Capsule::table($table);
            if ($where) {
                $query->where($where);
            }

            return (int) $query->count();
        } catch (\Exception $e) {
            Logger::error('Database count failed: ' . $e->getMessage(), ['table' => $table]);
            return 0;
        }
    }

    /**
     * SUM of a column (returns float, 0.0 on failure).
     */
    public static function sum(string $table, string $column, array $where = []): float
    {
        try {
            $query = Capsule::table($table);
            if ($where) {
                $query->where($where);
            }

            return (float) $query->sum($column);
        } catch (\Exception $e) {
            Logger::error('Database sum failed: ' . $e->getMessage(), ['table' => $table]);
            return 0.0;
        }
    }

    public static function delete(string $table, array $where): int
    {
        if (!$where) {
            // Guard rail: never allow an unbounded DELETE through this helper.
            Logger::error('Refusing to delete without conditions', ['table' => $table]);
            return 0;
        }

        try {
            return (int) Capsule::table($table)->where($where)->delete();
        } catch (\Exception $e) {
            Logger::error('Database delete failed: ' . $e->getMessage(), ['table' => $table]);
            return 0;
        }
    }

    /**
     * Does a table exist? Used by the installer/upgrader.
     */
    public static function tableExists(string $table): bool
    {
        try {
            return Capsule::schema()->hasTable($table);
        } catch (\Exception $e) {
            return false;
        }
    }

    public static function columnExists(string $table, string $column): bool
    {
        try {
            return Capsule::schema()->hasColumn($table, $column);
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Run a callback inside a transaction; rolls back and rethrows on error.
     *
     * @return mixed
     * @throws \Exception
     */
    public static function transaction(callable $callback)
    {
        return Capsule::connection()->transaction($callback);
    }

    public static function beginTransaction(): void
    {
        Capsule::connection()->beginTransaction();
    }

    public static function commit(): void
    {
        Capsule::connection()->commit();
    }

    public static function rollback(): void
    {
        Capsule::connection()->rollBack();
    }
}
