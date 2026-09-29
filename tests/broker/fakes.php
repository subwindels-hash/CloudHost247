<?php
/**
 * In-memory fakes for the CloudHost247 Domain Brokerage behavior suite.
 *
 * Provides a minimal but faithful fake of the WHMCS\Database\Capsule fluent
 * query builder (the same technique already used by tests/foundation/run.php
 * and tests/tools/run.php in this repository) plus a stub for
 * CloudHost247\Integrations\Services\IntegrationManager::installed() so every
 * provider adapter honestly reports "not configured" — exactly what it would
 * report in a real environment with no integration credentials saved. No
 * network access and no real database are used anywhere in this suite.
 */

class CH247BrokerFakeDB
{
    public static $tables = array();
    public static $autoId = array();

    public static function reset()
    {
        self::$tables = array();
        self::$autoId = array();
    }

    public static function &rowsRef($table)
    {
        if (!isset(self::$tables[$table])) { self::$tables[$table] = array(); }
        return self::$tables[$table];
    }

    public static function nextId($table)
    {
        if (!isset(self::$autoId[$table])) { self::$autoId[$table] = 0; }
        self::$autoId[$table]++;
        return self::$autoId[$table];
    }
}

/**
 * A tiny stand-in for the Illuminate\Support\Collection that a real
 * WHMCS\Database\Capsule::table(...)->get() call returns. Behaves like a
 * plain array for foreach/count/index access, but also supports the one
 * Collection-specific method the broker code actually calls:
 * ->first(callable $callback = null).
 */
class CH247BrokerFakeCollection implements \IteratorAggregate, \Countable, \ArrayAccess
{
    private $items;

    public function __construct(array $items) { $this->items = array_values($items); }

    public function first($callback = null)
    {
        foreach ($this->items as $item) {
            if ($callback === null || $callback($item)) { return $item; }
        }
        return null;
    }

    public function getIterator() { return new \ArrayIterator($this->items); }

    public function count() { return count($this->items); }

    public function offsetExists($offset) { return isset($this->items[$offset]); }

    public function offsetGet($offset) { return $this->items[$offset]; }

    public function offsetSet($offset, $value)
    {
        if ($offset === null) { $this->items[] = $value; } else { $this->items[$offset] = $value; }
    }

    public function offsetUnset($offset) { unset($this->items[$offset]); }

    public function toArray() { return $this->items; }
}

class CH247BrokerFakeQuery
{
    private $table;
    private $wheres = array();
    private $orderBys = array();
    private $limitN = null;
    private $offsetN = 0;
    private $selectRawExpr = null;

    public function __construct($table)
    {
        $this->table = $table;
    }

    public function where($col, $opOrVal = null, $val = null)
    {
        if ($col instanceof \Closure) {
            $sub = new self($this->table);
            $col($sub);
            $this->wheres[] = array('type' => 'group', 'logic' => 'and', 'wheres' => $sub->wheres);
            return $this;
        }
        if (func_num_args() >= 3) { $op = $opOrVal; } else { $op = '='; $val = $opOrVal; }
        $this->wheres[] = array('type' => 'basic', 'logic' => 'and', 'col' => $col, 'op' => $op, 'val' => $val);
        return $this;
    }

    public function orWhere($col, $opOrVal = null, $val = null)
    {
        if (func_num_args() >= 3) { $op = $opOrVal; } else { $op = '='; $val = $opOrVal; }
        $this->wheres[] = array('type' => 'basic', 'logic' => 'or', 'col' => $col, 'op' => $op, 'val' => $val);
        return $this;
    }

    public function whereNull($col) { $this->wheres[] = array('type' => 'null', 'logic' => 'and', 'col' => $col); return $this; }

    public function whereNotNull($col) { $this->wheres[] = array('type' => 'notnull', 'logic' => 'and', 'col' => $col); return $this; }

    public function orderBy($col, $dir = 'asc') { $this->orderBys[] = array($col, $dir); return $this; }

    public function groupBy($col) { return $this; } // grouping is inferred from the selectRaw expression itself

    public function select() { return $this; }

    public function selectRaw($expr) { $this->selectRawExpr = $expr; return $this; }

    public function limit($n) { $this->limitN = (int) $n; return $this; }

    public function offset($n) { $this->offsetN = (int) $n; return $this; }

    public function leftJoin() { return $this; }

    public function get() { return new CH247BrokerFakeCollection($this->rows(true)); }

    public function first()
    {
        $rows = $this->rows(false);
        return isset($rows[0]) ? $rows[0] : null;
    }

    public function count() { return count($this->filtered()); }

    public function exists() { return count($this->filtered()) > 0; }

    public function avg($col)
    {
        $rows = $this->filtered();
        $values = array();
        foreach ($rows as $row) { if (array_key_exists($col, $row) && $row[$col] !== null) { $values[] = (float) $row[$col]; } }
        return $values ? array_sum($values) / count($values) : null;
    }

    public function value($col)
    {
        $rows = $this->rows(false);
        return isset($rows[0]->$col) ? $rows[0]->$col : null;
    }

    public function insert($data)
    {
        if (isset($data[0]) && is_array($data[0])) {
            foreach ($data as $row) { $this->insertOne($row); }
            return true;
        }
        $this->insertOne($data);
        return true;
    }

    public function insertGetId($data) { return $this->insertOne($data); }

    public function update($data)
    {
        $rows = &CH247BrokerFakeDB::rowsRef($this->table);
        $count = 0;
        foreach ($rows as &$row) {
            if ($this->matches($row, $this->wheres)) { $row = array_merge($row, $data); $count++; }
        }
        unset($row);
        return $count;
    }

    public function delete()
    {
        $rows = &CH247BrokerFakeDB::rowsRef($this->table);
        $before = count($rows);
        $rows = array_values(array_filter($rows, function ($row) { return !$this->matches($row, $this->wheres); }));
        return $before - count($rows);
    }

    public function updateOrInsert(array $attributes, array $values = array())
    {
        $probe = new self($this->table);
        foreach ($attributes as $k => $v) { $probe->where($k, $v); }
        if ($probe->exists()) {
            $updater = new self($this->table);
            foreach ($attributes as $k => $v) { $updater->where($k, $v); }
            $updater->update($values);
            return true;
        }
        $this->insertOne(array_merge($attributes, $values));
        return true;
    }

    // -------------------------------------------------------------- internals

    private function insertOne($data)
    {
        $row = $data;
        if (!isset($row['id'])) { $row['id'] = CH247BrokerFakeDB::nextId($this->table); }
        $rows = &CH247BrokerFakeDB::rowsRef($this->table);
        $rows[] = $row;
        return $row['id'];
    }

    private function filtered()
    {
        $out = array();
        foreach (CH247BrokerFakeDB::rowsRef($this->table) as $row) {
            if ($this->matches($row, $this->wheres)) { $out[] = $row; }
        }
        return $out;
    }

    private function rows($applyPaging)
    {
        $rows = $this->filtered();
        if ($this->selectRawExpr !== null) { return $this->aggregate($rows); }
        if ($this->orderBys) {
            $orderBys = $this->orderBys;
            usort($rows, function ($a, $b) use ($orderBys) {
                foreach ($orderBys as $spec) {
                    list($col, $dir) = $spec;
                    $av = isset($a[$col]) ? $a[$col] : null;
                    $bv = isset($b[$col]) ? $b[$col] : null;
                    $cmp = $av == $bv ? 0 : ($av <=> $bv);
                    if (strtolower($dir) === 'desc') { $cmp = -$cmp; }
                    if ($cmp !== 0) { return $cmp; }
                }
                return ($a['id'] ?? 0) <=> ($b['id'] ?? 0);
            });
        }
        if ($applyPaging) {
            if ($this->offsetN) { $rows = array_slice($rows, $this->offsetN); }
            if ($this->limitN !== null) { $rows = array_slice($rows, 0, $this->limitN); }
        }
        return array_map(function ($row) { return (object) $row; }, array_values($rows));
    }

    private function aggregate($rows)
    {
        $expr = trim($this->selectRawExpr);
        if (preg_match('/^(\w+),\s*count\(\*\)\s*as\s*(\w+)$/i', $expr, $m)) {
            $col = $m[1]; $alias = $m[2];
            $groups = array();
            foreach ($rows as $row) {
                $key = isset($row[$col]) ? $row[$col] : '';
                if (!isset($groups[$key])) { $groups[$key] = 0; }
                $groups[$key]++;
            }
            $out = array();
            foreach ($groups as $key => $total) { $out[] = (object) array($col => $key, $alias => $total); }
            return $out;
        }
        $result = array();
        if (preg_match_all('/sum\((\w+)\)\s*as\s*(\w+)/i', $expr, $mm, PREG_SET_ORDER)) {
            foreach ($mm as $sumMatch) {
                $col = $sumMatch[1]; $alias = $sumMatch[2]; $sum = 0.0;
                foreach ($rows as $row) { $sum += isset($row[$col]) ? (float) $row[$col] : 0.0; }
                $result[$alias] = $sum;
            }
        }
        if (preg_match('/count\(\*\)\s*as\s*(\w+)/i', $expr, $cm)) { $result[$cm[1]] = count($rows); }
        return array((object) $result);
    }

    private function matches($row, $wheres)
    {
        $result = null;
        foreach ($wheres as $w) {
            $cond = $this->evalCondition($row, $w);
            if ($result === null) { $result = $cond; continue; }
            $result = ($w['logic'] === 'or') ? ($result || $cond) : ($result && $cond);
        }
        return $result === null ? true : $result;
    }

    private function evalCondition($row, $w)
    {
        if ($w['type'] === 'group') { return $this->matches($row, $w['wheres']); }
        if ($w['type'] === 'null') { return !array_key_exists($w['col'], $row) || $row[$w['col']] === null; }
        if ($w['type'] === 'notnull') { return array_key_exists($w['col'], $row) && $row[$w['col']] !== null; }
        $colVal = array_key_exists($w['col'], $row) ? $row[$w['col']] : null;
        $val = $w['val'];
        switch ($w['op']) {
            case '=': return $colVal == $val;
            case '!=': return $colVal != $val;
            case '>=': return $colVal >= $val;
            case '<=': return $colVal <= $val;
            case '>': return $colVal > $val;
            case '<': return $colVal < $val;
            case 'like':
                $pattern = '/^' . str_replace('%', '.*', preg_quote((string) $val, '/')) . '$/i';
                return (bool) preg_match($pattern, (string) $colVal);
            default: return false;
        }
    }
}

class CH247BrokerFakeSchema
{
    public function hasTable($name) { return true; }
}

if (!class_exists('WHMCS\\Database\\Capsule')) {
    eval('namespace WHMCS\\Database; class Capsule {
        public static function table($name) { return new \\CH247BrokerFakeQuery($name); }
        public static function schema() { return new \\CH247BrokerFakeSchema(); }
    }');
}

if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
    eval('namespace CloudHost247\\Integrations\\Services; class IntegrationManager {
        public static $installed = false;
        public static function installed() { return self::$installed; }
    }');
}

/** A honest test double for the legacy WHOIS/availability bridge: no network, no WHMCS, fully scripted. */
class CH247BrokerTestLookupBridge implements \CloudHost247\Broker\Domain\LookupBridgeInterface
{
    public $availability = null;
    public $whoisResult = null;

    public function checkAvailability($domain) { return $this->availability; }

    public function whois($domain) { return $this->whoisResult; }
}

if (!function_exists('localAPI')) {
    $GLOBALS['CH247_BROKER_INVOICES'] = array();
    $GLOBALS['CH247_BROKER_EMAILS'] = array();
    function localAPI($action, $params = array())
    {
        global $CH247_BROKER_INVOICES, $CH247_BROKER_EMAILS;
        if ($action === 'CreateInvoice') {
            $id = count($CH247_BROKER_INVOICES) + 1001;
            $CH247_BROKER_INVOICES[$id] = array('status' => 'Unpaid');
            return array('result' => 'success', 'invoiceid' => $id);
        }
        if ($action === 'GetInvoice') {
            $id = (int) (isset($params['invoiceid']) ? $params['invoiceid'] : 0);
            if (!isset($CH247_BROKER_INVOICES[$id])) { return array('result' => 'error', 'message' => 'Invoice not found'); }
            return array('result' => 'success', 'status' => $CH247_BROKER_INVOICES[$id]['status']);
        }
        if ($action === 'SendEmail') {
            $CH247_BROKER_EMAILS[] = $params;
            return array('result' => 'success');
        }
        return array('result' => 'error', 'message' => 'Unhandled localAPI action in test fake: ' . $action);
    }
}

function ch247_broker_set_invoice_status($invoiceId, $status)
{
    $GLOBALS['CH247_BROKER_INVOICES'][(int) $invoiceId]['status'] = $status;
}
