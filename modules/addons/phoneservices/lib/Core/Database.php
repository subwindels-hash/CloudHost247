<?php
namespace PhoneServices\Core;

use WHMCS\Database\Capsule;

/** Small Capsule gateway; all persistence uses WHMCS' configured PDO connection. */
class Database
{
    public static function table($table)
    {
        return Capsule::table($table);
    }

    public static function query($sql, $params = array())
    {
        return Capsule::connection()->select($sql, array_values($params));
    }

    public static function statement($sql, $params = array())
    {
        return Capsule::connection()->statement($sql, array_values($params));
    }

    public static function insert($table, $data)
    {
        return (int) self::table($table)->insertGetId($data);
    }

    public static function update($table, $data, $where)
    {
        return self::applyWhere(self::table($table), $where)->update($data);
    }

    public static function select($table, $fields = '*', $where = array(), $orderBy = 'id', $orderDir = 'ASC', $limit = null)
    {
        $query = self::applyWhere(self::table($table), $where);
        $fields = $fields === '*' ? array('*') : array_map('trim', explode(',', $fields));
        $query->select($fields)->orderBy($orderBy, strtolower($orderDir) === 'desc' ? 'desc' : 'asc');
        if ($limit !== null) {
            $query->limit(max(1, (int) $limit));
        }
        return array_map(function ($row) { return (array) $row; }, $query->get()->all());
    }

    public static function row($table, $fields = '*', $where = array())
    {
        $rows = self::select($table, $fields, $where, 'id', 'ASC', 1);
        return isset($rows[0]) ? $rows[0] : null;
    }

    public static function count($table, $where = array())
    {
        return (int) self::applyWhere(self::table($table), $where)->count();
    }

    public static function delete($table, $where)
    {
        if (!$where) {
            throw new \InvalidArgumentException('Refusing an unscoped delete');
        }
        return self::applyWhere(self::table($table), $where)->delete();
    }

    public static function beginTransaction() { Capsule::connection()->beginTransaction(); }
    public static function commit() { Capsule::connection()->commit(); }
    public static function rollback() { Capsule::connection()->rollBack(); }

    private static function applyWhere($query, array $where)
    {
        foreach ($where as $column => $value) {
            $query->where($column, '=', $value);
        }
        return $query;
    }
}
