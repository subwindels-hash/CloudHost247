<?php
/**
 * Database Helper
 * Provides safe database operations with escaping
 */

namespace PhoneServices\Core;

class Database
{
    /**
     * Execute a safe query with parameters
     */
    public static function query($sql, $params = [])
    {
        foreach ($params as $key => $value) {
            $sql = str_replace(':' . $key, "'" . db_escape_string($value) . "'", $sql);
        }
        
        $result = full_query($sql);
        
        if (!$result) {
            Logger::error('Database query failed: ' . $sql . ' | Error: ' . mysql_error());
        }
        
        return $result;
    }
    
    /**
     * Insert and return ID
     */
    public static function insert($table, $data)
    {
        $id = insert_query($table, $data);
        return $id;
    }
    
    /**
     * Update records
     */
    public static function update($table, $data, $where)
    {
        update_query($table, $data, $where);
    }
    
    /**
     * Select records
     */
    public static function select($table, $fields = '*', $where = [], $orderBy = 'id', $orderDir = 'ASC', $limit = null)
    {
        $result = select_query($table, $fields, $where, $orderBy, $orderDir, $limit);
        $rows = [];
        while ($row = mysql_fetch_assoc($result)) {
            $rows[] = $row;
        }
        return $rows;
    }
    
    /**
     * Get single row
     */
    public static function row($table, $fields = '*', $where = [])
    {
        $rows = self::select($table, $fields, $where, 'id', 'ASC', 1);
        return $rows ? $rows[0] : null;
    }
    
    /**
     * Count records
     */
    public static function count($table, $where = [])
    {
        $result = select_query($table, 'COUNT(*) as total', $where);
        $row = mysql_fetch_assoc($result);
        return (int) $row['total'];
    }
    
    /**
     * Delete records
     */
    public static function delete($table, $where)
    {
        delete_query($table, $where);
    }
    
    /**
     * Begin transaction (if supported)
     */
    public static function beginTransaction()
    {
        full_query('START TRANSACTION');
    }
    
    /**
     * Commit transaction
     */
    public static function commit()
    {
        full_query('COMMIT');
    }
    
    /**
     * Rollback transaction
     */
    public static function rollback()
    {
        full_query('ROLLBACK');
    }
}
