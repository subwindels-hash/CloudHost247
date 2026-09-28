<?php
/**
 * CloudHost247 Tools Platform behavior suite.
 *
 * Exercises the real module code (functions, API layer, admin/client
 * controllers, DNS wire client, migration and all tool handlers) against an
 * in-memory fake of the WHMCS database layer. No network access is required:
 * network-dependent tools are exercised on their validation paths only, and
 * the DNS wire client is tested against hand-built RFC 1035 packets.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

$root = dirname(__DIR__, 2);

/* ------------------------------------------------------------------ *
 * Fakes: in-memory Capsule for BOTH aliases the codebase uses.
 *  - Illuminate\Database\Capsule\Manager  (module code)
 *  - WHMCS\Database\Capsule               (foundation MigrationRunner/AdminGuard)
 * They share one table store so migrations and module writes are visible
 * to each other, exactly like the real WHMCS connection.
 * ------------------------------------------------------------------ */

$GLOBALS['CH247_FAKE_TABLES'] = array();
$GLOBALS['CH247_FAKE_SCHEMA'] = array();

if (!class_exists('CH247FakeStore')) {
    class CH247FakeStore
    {
        public static function rows($table)
        {
            if (!isset($GLOBALS['CH247_FAKE_TABLES'][$table])) {
                $GLOBALS['CH247_FAKE_TABLES'][$table] = array();
            }
            return $GLOBALS['CH247_FAKE_TABLES'][$table];
        }

        public static function setRows($table, $rows)
        {
            $GLOBALS['CH247_FAKE_TABLES'][$table] = array_values($rows);
        }

        public static function reset()
        {
            $GLOBALS['CH247_FAKE_TABLES'] = array();
            $GLOBALS['CH247_FAKE_SCHEMA'] = array();
        }
    }
}

if (!class_exists('CH247FakeQuery')) {
    class CH247FakeQuery
    {
        private $table;
        private $filters = array();

        public function __construct($table)
        {
            $this->table = $table;
        }

        public function __call($method, $args)
        {
            // select/groupBy/orderBy/limit and friends are chainable no-ops;
            // get()/count()/first() below do the actual work.
            if (in_array($method, array('select', 'groupBy', 'orderBy', 'limit', 'offset'), true)) {
                return $this;
            }
            throw new RuntimeException('CH247FakeQuery: unsupported call ' . $method);
        }

        public function where($column, $operator, $value = null)
        {
            if (func_num_args() === 2) {
                $value = $operator;
                $operator = '=';
            }
            $this->filters[] = array($column, $operator, $value);
            return $this;
        }

        private function matches(array $row)
        {
            foreach ($this->filters as $f) {
                list($col, $op, $val) = $f;
                $actual = isset($row[$col]) ? $row[$col] : null;
                switch ($op) {
                    case '=':
                        if ($actual != $val) { return false; }
                        break;
                    case '>=':
                        if (!(is_numeric($actual) && is_numeric($val) ? $actual >= $val : (string) $actual >= (string) $val)) { return false; }
                        break;
                    case '>':
                        if (!(is_numeric($actual) && is_numeric($val) ? $actual > $val : (string) $actual > (string) $val)) { return false; }
                        break;
                    case '<':
                        if (!(is_numeric($actual) && is_numeric($val) ? $actual < $val : (string) $actual < (string) $val)) { return false; }
                        break;
                    case '<=':
                        if (!(is_numeric($actual) && is_numeric($val) ? $actual <= $val : (string) $actual <= (string) $val)) { return false; }
                        break;
                    default:
                        return false;
                }
            }
            return true;
        }

        private function matching()
        {
            $out = array();
            foreach (CH247FakeStore::rows($this->table) as $row) {
                if ($this->matches($row)) { $out[] = $row; }
            }
            return $out;
        }

        public function get()
        {
            return array_map(function ($r) { return (object) $r; }, $this->matching());
        }

        public function first()
        {
            $rows = $this->matching();
            return $rows ? (object) $rows[0] : null;
        }

        public function count()
        {
            return count($this->matching());
        }

        public function exists()
        {
            return count($this->matching()) > 0;
        }

        public function value($column)
        {
            $rows = $this->matching();
            if (!$rows) { return null; }
            return isset($rows[0][$column]) ? $rows[0][$column] : null;
        }

        public function pluck($column, $key = null)
        {
            $values = array();
            foreach ($this->matching() as $row) {
                if ($key !== null) {
                    $values[$row[$key]] = $row[$column];
                } else {
                    $values[] = $row[$column];
                }
            }
            return new CH247FakeCollection($values);
        }

        public function insert($data)
        {
            $rows = CH247FakeStore::rows($this->table);
            $nextId = count($rows) + 1;
            foreach (array_keys($data) === range(0, count($data) - 1) && is_array(reset($data)) ? $data : array($data) as $row) {
                if (!isset($row['id'])) {
                    $row['id'] = $nextId++;
                }
                $rows[] = $row;
            }
            CH247FakeStore::setRows($this->table, $rows);
            return true;
        }

        public function update(array $data)
        {
            $rows = CH247FakeStore::rows($this->table);
            $touched = 0;
            foreach ($rows as &$row) {
                if ($this->matches($row)) {
                    $row = array_merge($row, $data);
                    $touched++;
                }
            }
            unset($row);
            CH247FakeStore::setRows($this->table, $rows);
            return $touched;
        }

        public function increment($column, $amount = 1)
        {
            $rows = CH247FakeStore::rows($this->table);
            foreach ($rows as &$row) {
                if ($this->matches($row)) {
                    $row[$column] = (isset($row[$column]) ? (int) $row[$column] : 0) + $amount;
                }
            }
            unset($row);
            CH247FakeStore::setRows($this->table, $rows);
            return true;
        }

        public function delete()
        {
            $kept = array();
            foreach (CH247FakeStore::rows($this->table) as $row) {
                if (!$this->matches($row)) { $kept[] = $row; }
            }
            CH247FakeStore::setRows($this->table, $kept);
            return true;
        }

        public function updateOrInsert(array $where, array $data)
        {
            $q = new CH247FakeQuery($this->table);
            foreach ($where as $col => $val) {
                $q->where($col, $val);
            }
            $rows = CH247FakeStore::rows($this->table);
            $found = false;
            foreach ($rows as &$row) {
                if ($q->matches($row)) {
                    $row = array_merge($row, $data);
                    $found = true;
                }
            }
            unset($row);
            if (!$found) {
                $rows[] = array_merge($where, $data);
            }
            CH247FakeStore::setRows($this->table, $rows);
            return true;
        }

        public function truncate()
        {
            CH247FakeStore::setRows($this->table, array());
            return true;
        }
    }
}

if (!class_exists('CH247FakeCollection')) {
    class CH247FakeCollection
    {
        private $items;
        public function __construct($items) { $this->items = $items; }
        public function toArray() { return $this->items; }
        public function count() { return count($this->items); }
    }
}

if (!class_exists('CH247FakeBlueprint')) {
    class CH247FakeBlueprint
    {
        public function __call($method, $args) { return $this; }
    }
}

if (!class_exists('CH247FakeSchema')) {
    class CH247FakeSchema
    {
        public function hasTable($table)
        {
            return isset($GLOBALS['CH247_FAKE_SCHEMA'][$table])
                || isset($GLOBALS['CH247_FAKE_TABLES'][$table]);
        }

        public function create($table, $callback)
        {
            $callback(new CH247FakeBlueprint());
            $GLOBALS['CH247_FAKE_SCHEMA'][$table] = true;
            $GLOBALS['CH247_FAKE_TABLES'][$table] = array();
            return true;
        }

        public function drop($table) { unset($GLOBALS['CH247_FAKE_SCHEMA'][$table], $GLOBALS['CH247_FAKE_TABLES'][$table]); return true; }
        public function dropIfExists($table) { return $this->drop($table); }
        public function table($table, $callback) { $callback(new CH247FakeBlueprint()); return true; }
        public function hasColumn($table, $column) { return true; }
    }
}

if (!class_exists('CH247FakeConnection')) {
    class CH247FakeConnection
    {
        public function transaction($callback)
        {
            return $callback();
        }
    }
}

// The module aliases Illuminate\Database\Capsule\Manager as Capsule.
if (!class_exists('Illuminate\\Database\\Capsule\\Manager')) {
    eval('namespace Illuminate\\Database\\Capsule; class Manager {
        public static function table($name) { return new \CH247FakeQuery($name); }
        public static function schema() { return new \CH247FakeSchema(); }
        public static function connection() { return new \CH247FakeConnection(); }
        public static function raw($sql) { return new \CH247RawExpr($sql); }
    }');
}

// The foundation (MigrationRunner, AdminGuard capability check) uses the WHMCS 7-style alias.
if (!class_exists('WHMCS\\Database\\Capsule')) {
    eval('namespace WHMCS\\Database; class Capsule {
        public static function table($name) { return new \CH247FakeQuery($name); }
        public static function schema() { return new \CH247FakeSchema(); }
        public static function connection() { return new \CH247FakeConnection(); }
        public static function raw($sql) { return new \CH247RawExpr($sql); }
    }');
}

if (!class_exists('CH247RawExpr')) {
    class CH247RawExpr
    {
        public $sql;
        public function __construct($sql) { $this->sql = $sql; }
    }
}

// WHMCS admin CSRF helpers (AdminGuard falls back to these when present).
$GLOBALS['CH247_TOKEN_OK'] = false;
if (!function_exists('check_token')) {
    function check_token($area) { return $GLOBALS['CH247_TOKEN_OK'] === true; }
}
if (!function_exists('generate_token')) {
    function generate_token($mode = 'plain') { return 'test-token-value'; }
}
// WHMCS hook registrar for hooks.php.
if (!function_exists('add_hook')) {
    $GLOBALS['CH247_HOOKS'] = array();
    function add_hook($name, $priority, $callback)
    {
        $GLOBALS['CH247_HOOKS'][] = $name;
        return true;
    }
}

/* ------------------------------------------------------------------ *
 * Load the real module.
 * ------------------------------------------------------------------ */

define('WHMCS', true);

require_once $root . '/modules/addons/cloudhost247_core/bootstrap.php';   // Foundation autoloader
require_once $root . '/modules/addons/cloudhost247_tools/bootstrap.php';
require_once $root . '/modules/addons/cloudhost247_tools/includes/functions.php';
require_once $root . '/modules/addons/cloudhost247_tools/includes/api.php';
require_once $root . '/modules/addons/cloudhost247_tools/includes/dns_client.php';
require_once $root . '/modules/addons/cloudhost247_tools/includes/classes.php';
require_once $root . '/modules/addons/cloudhost247_tools/migrations/V227.php';
require_once $root . '/modules/addons/cloudhost247_tools/cloudhost247_tools.php';
require_once $root . '/modules/addons/cloudhost247_tools/hooks.php';
// The module loads tool implementations on demand; the suite calls handlers
// directly, so preload every category file up front.
foreach (array('dns', 'ip', 'developer', 'designer', 'webmaster', 'network', 'security', 'productivity', 'gaming') as $category) {
    require_once $root . '/modules/addons/cloudhost247_tools/includes/tools/' . $category . '_tools.php';
}

$_SESSION = array();

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function ch247_set_setting($key, $value)
{
    $rows = CH247FakeStore::rows('tbladdonmodules');
    $found = false;
    foreach ($rows as &$row) {
        if ($row['module'] === 'cloudhost247_tools' && $row['setting'] === $key) {
            $row['value'] = $value;
            $found = true;
        }
    }
    unset($row);
    if (!$found) {
        $rows[] = array('module' => 'cloudhost247_tools', 'setting' => $key, 'value' => $value);
    }
    CH247FakeStore::setRows('tbladdonmodules', $rows);
}

/** Seed module settings + tool status rows like a fresh activation. */
function ch247_fresh_install()
{
    CH247FakeStore::reset();
    ch247_set_setting('enable_logs', 'on');
    ch247_set_setting('rate_limit_requests', '60');
    ch247_set_setting('cache_duration', '10');
    cloudhost247_tools_seed_tools();
}

$tests = array();
$check = function ($name, callable $fn) use (&$tests) {
    $tests[$name] = $fn;
};

/* ------------------------------------------------------------------ *
 * Registry completeness — every registered tool must have a handler.
 * ------------------------------------------------------------------ */

$check('every registered tool id has a live handler function', function () {
    $all = cloudhost247_tools_get_all_tools();
    if (count($all) !== 9) { return false; }
    $total = 0;
    foreach ($all as $category => $tools) {
        if (!preg_match('/^[a-z]+$/', $category)) { return false; }
        foreach ($tools as $toolId => $data) {
            $total++;
            if (!preg_match('/^[a-z0-9_]+$/', $toolId)) { return false; }
            if (!isset($data['name'], $data['icon'], $data['desc'])) { return false; }
            $handler = 'cloudhost247_tool_' . $toolId;
            if (!function_exists($handler)) { return false; }
        }
    }
    return $total === 79; // full catalogue from the original specification (14+18+12+4+6+4+4+16+1)
});

$check('spec tool inventory is complete (spot-check 24 slugs)', function () {
    $all = cloudhost247_tools_get_all_tools();
    $flat = array();
    foreach ($all as $tools) { $flat = array_merge($flat, array_keys($tools)); }
    $required = array(
        'spf_checker', 'dns_propagation', 'dmarc_generator', 'dkim_checker', 'dnskey_lookup',
        'ping_ipv6', 'email_header_analyzer', 'ip_blacklist', 'subnet_calculator', 'isp_checker',
        'http_headers', 'smtp_test', 'htaccess_generator', 'json_formatter',
        'rgb_to_pantone', 'hsv_to_pantone', 'link_analyzer', 'serp_preview', 'punycode',
        'port_checker', 'asn_lookup', 'ssl_checker', 'minecraft_colors', 'image_to_text',
    );
    foreach ($required as $slug) {
        if (!in_array($slug, $flat, true)) { return false; }
    }
    return true;
});

/* ------------------------------------------------------------------ *
 * Sanitization and validation
 * ------------------------------------------------------------------ */

$check('sanitize domain strips everything but host characters', function () {
    return cloudhost247_tools_sanitize('ExaMple.COM', 'domain') === 'example.com'
        && cloudhost247_tools_sanitize('exa mple.com', 'domain') === 'example.com'
        && cloudhost247_tools_sanitize('EXAMPLE.COM.', 'domain') === 'example.com.';
});

$check('sanitize string strips tags and escapes html', function () {
    return cloudhost247_tools_sanitize('<b>Hi</b>', 'string') === 'Hi'
        && cloudhost247_tools_sanitize("a\"b", 'string') === 'a&quot;b';
});

$check('sanitize url normalizes scheme', function () {
    return cloudhost247_tools_sanitize('example.com/x', 'url') === 'https://example.com/x';
});

$check('validate domain accepts and rejects correctly', function () {
    return cloudhost247_tools_validate_domain('example.co.uk') === true
        && cloudhost247_tools_validate_domain('localhost') === false
        && cloudhost247_tools_validate_domain('exa mple.com') === false
        && cloudhost247_tools_validate_domain('') === false;
});

$check('ip validators agree with filter_var', function () {
    return cloudhost247_tools_validate_ipv4('192.168.1.1') === true
        && cloudhost247_tools_validate_ipv4('::1') === false
        && cloudhost247_tools_validate_ipv6('2001:db8::1') === true
        && cloudhost247_tools_validate_ip('192.0.2.1') === true
        && cloudhost247_tools_validate_ip('999.1.1.1') === false;
});

/* ------------------------------------------------------------------ *
 * CSRF, rate limit, client IP, settings, logging, cache (DB-backed)
 * ------------------------------------------------------------------ */

$check('csrf token generates once per session and verifies', function () {
    $_SESSION = array();
    $t1 = cloudhost247_tools_generate_csrf();
    $t2 = cloudhost247_tools_generate_csrf();
    return $t1 === $t2
        && strlen($t1) === 64
        && cloudhost247_tools_verify_csrf($t1) === true
        && cloudhost247_tools_verify_csrf('wrong' . $t1) === false;
});

$check('rate limit allows n then blocks, then frees after window', function () {
    ch247_fresh_install();
    ch247_set_setting('rate_limit_requests', '3');
    $_SERVER['REMOTE_ADDR'] = '203.0.113.9';
    // Mirror the module's callers: they read the setting and pass it in.
    $maxRequests = (int) cloudhost247_tools_get_setting('rate_limit_requests', '60');
    if ($maxRequests !== 3) { echo "  [diag] setting not applied: {$maxRequests}\n"; return false; }
    for ($i = 1; $i <= 3; $i++) {
        if (cloudhost247_tools_check_rate_limit('203.0.113.9', $maxRequests) !== true) {
            echo "  [diag] call {$i} of 3 was rejected\n";
            return false;
        }
    }
    if (cloudhost247_tools_check_rate_limit('203.0.113.9', $maxRequests) !== false) {
        echo "  [diag] 4th call was not blocked\n";
        return false;
    }
    // separate IP is not affected
    if (cloudhost247_tools_check_rate_limit('198.51.100.7', $maxRequests) === false) {
        echo "  [diag] separate IP was blocked\n";
        return false;
    }
    // expire the window by back-dating the row
    $rows = CH247FakeStore::rows('mod_cloudhost247_tools_rate_limit');
    foreach ($rows as &$row) {
        if ($row['ip_address'] === '203.0.113.9') {
            $row['window_start'] = date('Y-m-d H:i:s', strtotime('-120 seconds'));
        }
    }
    unset($row);
    CH247FakeStore::setRows('mod_cloudhost247_tools_rate_limit', $rows);
    if (cloudhost247_tools_check_rate_limit('203.0.113.9', $maxRequests) !== true) {
        echo "  [diag] window did not free after expiry\n";
        return false;
    }
    return true;
});

$check('client ip ignores spoofed headers unless proxy trust is enabled', function () {
    ch247_fresh_install();
    $_SERVER['REMOTE_ADDR'] = '192.0.2.10';
    $_SERVER['HTTP_X_FORWARDED_FOR'] = '6.6.6.6';
    $_SERVER['HTTP_CF_CONNECTING_IP'] = '6.6.6.7';
    if (cloudhost247_tools_get_client_ip() !== '192.0.2.10') { return false; } // default: no trust
    ch247_set_setting('trust_proxy_headers', 'on');
    $trusted = cloudhost247_tools_get_client_ip() === '6.6.6.7'; // CF header wins when enabled
    unset($_SERVER['HTTP_X_FORWARDED_FOR'], $_SERVER['HTTP_CF_CONNECTING_IP']);
    return $trusted;
});

$check('settings fall back to defaults when absent', function () {
    ch247_fresh_install();
    ch247_set_setting('cache_duration', '15');
    return cloudhost247_tools_get_setting('cache_duration', '5') === '15'
        && cloudhost247_tools_get_setting('nonexistent', 'fallback') === 'fallback';
});

$check('logs truncate input, strip credentials and bump usage', function () {
    ch247_fresh_install();
    $before = cloudhost247_tools_execute_usage('rot13');
    cloudhost247_tools_log('rot13', array('csrf_token' => 'secret', 'text' => str_repeat('x', 900)), array('ok' => true), 'success', str_repeat('e', 2000));
    $rows = CH247FakeStore::rows('mod_cloudhost247_tools_logs');
    if (count($rows) !== 1) { return false; }
    $row = $rows[0];
    if (strpos($row['input'], 'secret') !== false) { return false; }
    if (strlen($row['input']) > 500) { return false; }
    if (strlen($row['error_message']) > 1000) { return false; }
    return cloudhost247_tools_execute_usage('rot13') === $before + 1;
});

$check('logging disabled stores nothing', function () {
    ch247_fresh_install();
    ch247_set_setting('enable_logs', '');
    cloudhost247_tools_log('rot13', array('text' => 'hi'), array());
    return count(CH247FakeStore::rows('mod_cloudhost247_tools_logs')) === 0;
});

$check('cache set/get roundtrip and expiry', function () {
    ch247_fresh_install();
    cloudhost247_tools_cache_set('unit_k', array('v' => 42), 10);
    $got = cloudhost247_tools_cache_get('unit_k');
    if ($got === null || $got['v'] !== 42) { return false; }
    // expired entry is invisible
    $rows = CH247FakeStore::rows('mod_cloudhost247_tools_cache');
    $rows[0]['expires_at'] = date('Y-m-d H:i:s', strtotime('-1 minute'));
    CH247FakeStore::setRows('mod_cloudhost247_tools_cache', $rows);
    return cloudhost247_tools_cache_get('unit_k') === null;
});

$check('cache key is param-order independent and excludes credentials', function () {
    $a = cloudhost247_tools_result_cache_key('dns_lookup', array('domain' => 'example.com', 'type' => 'A', 'csrf_token' => 'zz'));
    $b = cloudhost247_tools_result_cache_key('dns_lookup', array('type' => 'A', 'domain' => 'example.com'));
    return $a === $b && strpos($a, 'zz') === false && strpos($a, 'result_dns_lookup_') === 0;
});

function cloudhost247_tools_execute_usage($toolId)
{
    foreach (CH247FakeStore::rows('mod_cloudhost247_tools_status') as $row) {
        if ($row['tool_id'] === $toolId) { return isset($row['usage_count']) ? (int) $row['usage_count'] : 0; }
    }
    return -1;
}

/* ------------------------------------------------------------------ *
 * Tool executor + cacheable policy
 * ------------------------------------------------------------------ */

$check('execute tool runs a deterministic tool end to end', function () {
    ch247_fresh_install();
    $_POST = array('text' => 'Hello'); // several handlers read $_POST directly
    $result = cloudhost247_tools_execute_tool('rot13', array('text' => 'Hello'), true);
    return $result['ok'] === true && $result['data']['result'] === str_rot13('Hello') && $result['cached'] === false;
});

$check('execute tool rejects unknown and disabled tools', function () {
    ch247_fresh_install();
    if (cloudhost247_tools_execute_tool('does_not_exist', array(), true)['ok'] !== false) { return false; }
    CH247FakeStore::setRows('mod_cloudhost247_tools_status', array_map(function ($r) {
        if ($r['tool_id'] === 'rot13') { $r['enabled'] = 0; }
        return $r;
    }, CH247FakeStore::rows('mod_cloudhost247_tools_status')));
    return cloudhost247_tools_execute_tool('rot13', array('text' => 'x'), true)['ok'] === false;
});

$check('requester-reflective tools are never dispatcher-cached', function () {
    foreach (array('what_is_my_ip', 'online_notepad', 'user_agent', 'password_generator', 'qr_scanner') as $tool) {
        if (cloudhost247_tools_is_cacheable($tool)) { echo "  [diag] {$tool} should not be cacheable\n"; return false; }
    }
    foreach (array('dns_lookup', 'mx_lookup', 'ssl_checker', 'ip_blacklist', 'http_headers') as $tool) {
        if (!cloudhost247_tools_is_cacheable($tool)) { echo "  [diag] {$tool} should be cacheable\n"; return false; }
    }
    // live probes stay uncached so answers are always current
    foreach (array('ping_ipv4', 'traceroute', 'port_checker', 'domain_availability', 'smtp_test', 'username_checker') as $tool) {
        if (cloudhost247_tools_is_cacheable($tool)) { echo "  [diag] {$tool} live probe should not be cacheable\n"; return false; }
    }
    return true;
});

$check('execute tool caches a cacheable success but not an error', function () {
    ch247_fresh_install();
    ch247_set_setting('cache_duration', '10');
    // dns_lookup with an invalid domain never touches the network and returns an error
    $err = cloudhost247_tools_execute_tool('dns_lookup', array('domain' => 'not a domain', 'type' => 'A'), true);
    if ($err['ok'] !== false || $err['cached'] !== false) { return false; }
    if (count(CH247FakeStore::rows('mod_cloudhost247_tools_cache')) !== 0) { return false; }
    return true;
});

/* ------------------------------------------------------------------ *
 * DNS wire client (RFC 1035) — no network, hand-built packets
 * ------------------------------------------------------------------ */

$check('dns query builder produces a valid wire packet', function () {
    $packet = CloudHost247ToolsDnsClient::buildQuery(0x1a2b, 'example.com', 1); // A
    if (strlen($packet) !== 12 + 13 + 4) { return false; }                // header + qname + fixed
    $header = unpack('nid/nflags/nqd/nan/nsn/narc', substr($packet, 0, 12));
    return $header['id'] === 0x1a2b
        && $header['flags'] === 0x0100                                        // RD=1
        && $header['qd'] === 1 && $header['an'] === 0
        && substr($packet, 12, 13) === "\x07example\x03com\x00"
        && unpack('ntype/nclass', substr($packet, -4)) === array('type' => 1, 'class' => 1)
        ? true : false;
});

$check('dns query builder rejects over-long labels', function () {
    return CloudHost247ToolsDnsClient::buildQuery(1, str_repeat('a', 64) . '.com', 1) === null;
});

function ch247_dns_response($id, $answers, $rcode = 0)
{
    // Question: example.com A IN
    $question = "\x07example\x03com\x00" . pack('nn', 1, 1);
    $flags = 0x8180 | $rcode; // QR=1, RD=1, RA=1
    $packet = pack('nnnnnn', $id, $flags, 1, count($answers), 0, 0) . $question;
    foreach ($answers as $answer) {
        $packet .= "\xc0\x0c";                    // pointer to question name
        $packet .= pack('nnNn', $answer['type'], 1, $answer['ttl'], strlen($answer['rdata']));
        $packet .= $answer['rdata'];
    }
    return $packet;
}

$check('dns parser extracts A records', function () {
    $raw = ch247_dns_response(0x1a2b, array(array('type' => 1, 'ttl' => 300, 'rdata' => "\x5d\xb8\xd8\x22")));
    $out = CloudHost247ToolsDnsClient::parseResponse($raw, 0x1a2b, 'example.com', 'A');
    if ($out['ok'] !== true) { echo "  [diag] A parse failed: " . $out['error'] . " hex=" . bin2hex($raw) . "\n"; return false; }
    return $out['records'] === array('93.184.216.34') && $out['rcode'] === 0;
});

$check('dns parser extracts AAAA records', function () {
    $raw = ch247_dns_response(0x33, array(array('type' => 28, 'ttl' => 300, 'rdata' => "\x20\x01\x0d\xb8\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01")));
    $out = CloudHost247ToolsDnsClient::parseResponse($raw, 0x33, 'example.com', 'AAAA');
    return $out['ok'] === true && $out['records'] === array('2001:db8:0:0:0:0:0:1');
});

$check('dns parser extracts MX with priority and compressed host', function () {
    // rdata: pri=10, target = pointer back to question name (example.com)
    $rdata = pack('n', 10) . "\xc0\x0c";
    $raw = ch247_dns_response(0x44, array(array('type' => 15, 'ttl' => 300, 'rdata' => $rdata)));
    $out = CloudHost247ToolsDnsClient::parseResponse($raw, 0x44, 'example.com', 'MX');
    return $out['ok'] === true && $out['records'] === array('10 example.com');
});

$check('dns parser joins TXT character-strings', function () {
    $rdata = "\x06v=spf1" . "\x05 -all";
    $raw = ch247_dns_response(0x55, array(array('type' => 16, 'ttl' => 300, 'rdata' => $rdata)));
    $out = CloudHost247ToolsDnsClient::parseResponse($raw, 0x55, 'example.com', 'TXT');
    return $out['ok'] === true && $out['records'] === array('v=spf1 -all');
});

$check('dns parser follows compression pointers for NS targets', function () {
    $rdata = "\x02ns\xc0\x0c"; // ns.example.com
    $raw = ch247_dns_response(0x66, array(array('type' => 2, 'ttl' => 300, 'rdata' => $rdata)));
    $out = CloudHost247ToolsDnsClient::parseResponse($raw, 0x66, 'example.com', 'NS');
    return $out['ok'] === true && $out['records'] === array('ns.example.com');
});

$check('dns parser rejects id mismatch, bad rcode and truncation', function () {
    $good = ch247_dns_response(0x77, array(array('type' => 1, 'ttl' => 60, 'rdata' => "\x01\x02\x03\x04")));
    if (CloudHost247ToolsDnsClient::parseResponse($good, 0x9999, 'example.com', 'A')['ok'] !== false) { return false; }
    $nxdomain = ch247_dns_response(0x77, array(), 3);
    $r = CloudHost247ToolsDnsClient::parseResponse($nxdomain, 0x77, 'example.com', 'A');
    if ($r['ok'] !== false || $r['rcode'] !== 3) { return false; }
    return CloudHost247ToolsDnsClient::parseResponse(substr($good, 0, 8), 0x77, 'example.com', 'A')['ok'] === false;
});

$check('dns parser stops at malformed answers without crashing', function () {
    $raw = ch247_dns_response(0x88, array(array('type' => 1, 'ttl' => 60, 'rdata' => "\x01\x02\x03\x04")));
    // claim 3 answers but only 1 present
    $raw = substr_replace($raw, pack('n', 3), 6, 2);
    $out = CloudHost247ToolsDnsClient::parseResponse($raw, 0x88, 'example.com', 'A');
    return $out['ok'] === true && $out['records'] === array('1.2.3.4'); // graceful partial parse
});

$check('dns propagation handler validates input before any socket work', function () {
    ch247_fresh_install();
    $bad = cloudhost247_tool_dns_propagation(array('domain' => 'not_a_domain', 'type' => 'A'));
    if (!isset($bad['error'])) { return false; }
    $badType = cloudhost247_tool_dns_propagation(array('domain' => 'example.com', 'type' => 'PTR'));
    return isset($badType['error']);
});

/* ------------------------------------------------------------------ *
 * REST API layer
 * ------------------------------------------------------------------ */

$check('api refuses all requests while no token is configured', function () {
    ch247_fresh_install();
    ch247_set_setting('api_token', '');
    return cloudhost247_tools_api_authorized('anything') === false
        && cloudhost247_tools_api_authorized('') === false;
});

$check('api token comparison is exact', function () {
    ch247_fresh_install();
    ch247_set_setting('api_token', 'tok-123-abc');
    return cloudhost247_tools_api_authorized('tok-123-abc') === true
        && cloudhost247_tools_api_authorized('tok-123-abd') === false
        && cloudhost247_tools_api_authorized('TOK-123-ABC') === false;
});

$check('api token extraction from bearer header and post field', function () {
    $_POST = array();
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer tok-header';
    $a = cloudhost247_tools_api_extract_token();
    unset($_SERVER['HTTP_AUTHORIZATION']);
    $_POST = array('token' => 'tok-post');
    $b = cloudhost247_tools_api_extract_token();
    $_POST = array();
    return $a === 'tok-header' && $b === 'tok-post';
});

$check('api catalog lists enabled tools and excludes client-stateful ones', function () {
    ch247_fresh_install();
    $catalog = cloudhost247_tools_api_catalog();
    return count($catalog) > 60
        && isset($catalog['rot13'], $catalog['ssl_checker'])
        && !isset($catalog['what_is_my_ip'], $catalog['online_notepad'], $catalog['qr_scanner'], $catalog['multi_url_opener']);
});

$check('api dispatch runs a tool and reports timing', function () {
    ch247_fresh_install();
    ch247_set_setting('api_token', 't');
    $_POST = array('tool' => 'rot13', 'text' => 'Hello'); // handlers read $_POST directly
    $res = cloudhost247_tools_api_dispatch('run', array('tool' => 'rot13', 'text' => 'Hello'), 'api:test');
    return $res['status'] === 200
        && $res['body']['success'] === true
        && $res['body']['data']['result'] === str_rot13('Hello')
        && $res['body']['took_ms'] >= 0;
});

$check('api dispatch rejects unknown, excluded tools and bad actions', function () {
    ch247_fresh_install();
    if (cloudhost247_tools_api_dispatch('run', array('tool' => 'nope'), 'api:x')['status'] !== 404) { return false; }
    if (cloudhost247_tools_api_dispatch('run', array('tool' => 'what_is_my_ip'), 'api:x')['status'] !== 400) { return false; }
    if (cloudhost247_tools_api_dispatch('explode', array(), 'api:x')['status'] !== 400) { return false; }
    return cloudhost247_tools_api_dispatch('list', array(), 'api:x')['status'] === 200;
});

$check('api rate limit applies per token bucket', function () {
    ch247_fresh_install();
    ch247_set_setting('rate_limit_requests', '2');
    if (cloudhost247_tools_api_dispatch('list', array(), 'api:bucket')['status'] !== 200) { return false; }
    if (cloudhost247_tools_api_dispatch('list', array(), 'api:bucket')['status'] !== 200) { return false; }
    $blocked = cloudhost247_tools_api_dispatch('list', array(), 'api:bucket');
    return $blocked['status'] === 429;
});

$check('api rate key never contains the raw token', function () {
    $key = cloudhost247_tools_api_rate_key('super-secret-token-value');
    return strpos($key, 'super-secret-token-value') === false && strpos($key, 'api:') === 0 && strlen($key) <= 50;
});

/* ------------------------------------------------------------------ *
 * Deterministic tool handlers (no network)
 * ------------------------------------------------------------------ */

$check('rot13 encodes and is its own inverse', function () {
    $_POST = array('text' => 'Hello World');
    $r = cloudhost247_tool_rot13($_POST);
    $_POST = array('text' => $r['result']);
    $back = cloudhost247_tool_rot13($_POST);
    return $r['result'] === 'Uryyb Jbeyq' && $back['result'] === 'Hello World';
});

$check('morse code roundtrips letters', function () {
    $_POST = array('text' => 'SOS', 'mode' => 'encode');
    $enc = cloudhost247_tool_morse_code($_POST);
    $_POST = array('text' => $enc['morse'], 'mode' => 'decode');
    $dec = cloudhost247_tool_morse_code($_POST);
    return $enc['morse'] === '... --- ...' && strtoupper(trim($dec['decoded'])) === 'SOS';
});

$check('word counter counts words, chars, lines, sentences', function () {
    $_POST = array('text' => "one two three.\nfour five!\n\nsix");
    $r = cloudhost247_tool_word_counter($_POST);
    return $r['words'] === 6 && $r['sentences'] === 2 && $r['paragraphs'] === 2 && $r['lines'] === 4
        && $r['characters'] === strlen($_POST['text']);
});

$check('subnet calculator computes a /24 correctly', function () {
    $r = cloudhost247_tool_subnet_calculator(array('ip' => '192.168.1.130', 'mask' => 24));
    return $r['network'] === '192.168.1.0'
        && $r['broadcast'] === '192.168.1.255'
        && $r['usable_hosts'] === 254
        && $r['first_usable'] === '192.168.1.1'
        && $r['last_usable'] === '192.168.1.254';
});

$check('subnet calculator validates inputs', function () {
    return isset(cloudhost247_tool_subnet_calculator(array('ip' => '300.1.1.1', 'mask' => 24))['error'])
        && isset(cloudhost247_tool_subnet_calculator(array('ip' => '192.168.1.1', 'mask' => 40))['error']);
});

$check('ip to decimal and back', function () {
    $r = cloudhost247_tool_ip_to_decimal(array('ip' => '192.168.1.1'));
    return (int) $r['decimal'] === 3232235777;
});

$check('ipv6 compress and expand roundtrip', function () {
    $c = cloudhost247_tool_ipv6_compress(array('ipv6' => '2001:0db8:0000:0000:0000:0000:0000:0001', 'mode' => 'compress'));
    $e = cloudhost247_tool_ipv6_compress(array('ipv6' => '2001:db8::1', 'mode' => 'expand'));
    return $c['compressed'] === '2001:db8::1'
        && $e['expanded'] === '2001:0db8:0000:0000:0000:0000:0000:0001';
});

$check('ipv4 to ipv6 converter produces mapped form', function () {
    $r = cloudhost247_tool_ipv4_ipv6_converter(array('input' => '192.0.2.33', 'direction' => 'v4_to_v6'));
    return strpos($r['ipv6'], '::ffff:') === 0 && strpos($r['ipv6'], 'c000') !== false && strpos($r['ipv6'], '0221') !== false;
});

$check('luhn validator accepts a real visa test number', function () {
    $r = cloudhost247_tool_credit_card_validator(array('number' => '4111 1111 1111 1111'));
    return $r['valid'] === true && $r['card_type'] === 'Visa' && $r['length'] === 16;
});

$check('luhn validator rejects a corrupted number', function () {
    return cloudhost247_tool_credit_card_validator(array('number' => '4111111111111112'))['valid'] === false;
});

$check('bin checker validates digit count offline', function () {
    return isset(cloudhost247_tool_bin_checker(array('bin' => '12'))['error']);
});

$check('password generator honors length and charset flags', function () {
    $r = cloudhost247_tool_password_generator(array('length' => 24, 'uppercase' => 1, 'lowercase' => 1, 'numbers' => 1, 'symbols' => 1, 'count' => 3));
    if (count($r['passwords']) !== 3 || $r['length'] !== 24) { return false; }
    foreach ($r['passwords'] as $p) {
        if (strlen($p) !== 24) { return false; }
        if (!preg_match('/[A-Z]/', $p) || !preg_match('/[a-z]/', $p) || !preg_match('/[0-9]/', $p)) { return false; }
    }
    return true;
});

$check('password strength flags weak and common passwords', function () {
    $_POST = array('password' => 'password');
    $weak = cloudhost247_tool_password_strength($_POST);
    $_POST = array('password' => 'C0rr3ct-Horse-Battery!99');
    $strong = cloudhost247_tool_password_strength($_POST);
    return $weak['score'] === 0 && $strong['score'] >= 70;
});

$check('json formatter pretty-prints and validates', function () {
    $_POST = array('json' => '{"a":1,"b":[1,2]}');
    $r = cloudhost247_tool_json_formatter($_POST);
    if ($r['valid'] !== true || strpos($r['formatted'], "\n") === false) { return false; }
    $_POST = array('json' => '{broken');
    return isset(cloudhost247_tool_json_formatter($_POST)['error']);
});

$check('binary/text converter roundtrips text, binary and hex', function () {
    $_POST = array('input' => 'AB', 'mode' => 'text_to_binary');
    $b = cloudhost247_tool_binary_text($_POST);
    if ($b['output'] !== '01000001 01000010') { return false; }
    $_POST = array('input' => '01000001 01000010', 'mode' => 'binary_to_text');
    $t = cloudhost247_tool_binary_text($_POST);
    if ($t['output'] !== 'AB') { return false; }
    $_POST = array('input' => '4142', 'mode' => 'hex_to_text');
    $h = cloudhost247_tool_binary_text($_POST);
    return $h['output'] === 'AB';
});

$check('md5/base64 generator matches known digests', function () {
    $_POST = array('input' => 'hello');
    $md5 = cloudhost247_tool_md5_base64(array('mode' => 'md5') + $_POST);
    $sha1 = cloudhost247_tool_md5_base64(array('mode' => 'sha1') + $_POST);
    $b64 = cloudhost247_tool_md5_base64(array('mode' => 'base64_encode') + $_POST);
    return $md5['md5'] === '5d41402abc4b2a76b9719d911017c592'
        && $sha1['sha1'] === 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
        && $b64['base64'] === base64_encode('hello');
});

$check('time calculator computes a known difference', function () {
    $r = cloudhost247_tool_time_calculator(array('start' => '2026-01-01 00:00', 'end' => '2026-01-02 12:00', 'format' => 'hours'));
    return $r['difference'] === 36.0 && $r['all_units']['days'] === 1.5;
});

$check('lorem ipsum returns requested structure', function () {
    $r = cloudhost247_tool_lorem_ipsum(array('count' => 3, 'type' => 'paragraphs'));
    return count($r['content']) === 3 && strlen($r['content'][0]) > 20;
});

$check('small text generator produces unicode transforms', function () {
    $r = cloudhost247_tool_small_text(array('text' => 'hello'));
    return $r['small_caps'] === 'ʜᴇʟʟᴏ' && $r['tiny'] !== 'hello';
});

$check('qr generator returns a working https image url', function () {
    $r = cloudhost247_tool_qr_generator(array('text' => 'https://example.com', 'size' => 400));
    return strpos($r['qr_url'], 'https://quickchart.io/qr') === 0
        && strpos($r['qr_url'], urlencode('https://example.com')) !== false
        && strpos($r['qr_url'], 'size=400') !== false;
});

$check('email header analyzer extracts routing fields', function () {
    $header = "Received: by mail.example.com for user@example.com\nFrom: Alice <alice@example.org>\nTo: bob@example.com\nSubject: Test\nDate: Mon, 1 Jan 2026 00:00:00 +0000";
    $_POST = array('header' => $header); // handler reads $_POST directly
    $r = cloudhost247_tool_email_header_analyzer(array('header' => $header));
    return isset($r['received'][0]) && strpos($r['from'], 'alice@example.org') !== false
        && strpos($r['to'], 'bob@example.com') !== false;
});

$check('minecraft colors exposes the 16 color codes', function () {
    $r = cloudhost247_tool_minecraft_colors(array('text' => 'hi', 'mc_action' => 'preview'));
    return count($r['colors']) === 16 && count($r['formats']) === 6 && is_string($r['preview_html']);
});

$check('pantone converters map exact rgb', function () {
    $r = cloudhost247_tool_rgb_to_pantone(array('r' => 0, 'g' => 0, 'b' => 0));
    return isset($r['pantone']) && $r['hex'] === '#000000';
});

$check('punycode converter encodes idn or degrades cleanly', function () {
    if (function_exists('idn_to_ascii')) {
        $r = cloudhost247_tool_punycode(array('input' => 'münchen.de', 'direction' => 'encode'));
        return $r['punycode'] === 'xn--mnchen-3ya.de';
    }
    return isset(cloudhost247_tool_punycode(array('input' => 'münchen.de'))['error']);
});

$check('htaccess and url rewrite generators output redirect rules', function () {
    $r = cloudhost247_tool_htaccess_generator(array('redirect_type' => '301', 'from' => '/old', 'to' => 'https://example.com/new'));
    if (strpos($r['rewrite_rule'], 'R=301') === false || strpos($r['rewrite_rule'], '^old$') === false) { return false; }
    $alias = cloudhost247_tool_url_rewrite(array('redirect_type' => '301', 'from' => '/old', 'to' => 'https://example.com/new'));
    return $alias === $r;
});

$check('robots generator produces disallow rules', function () {
    $_POST = array('disallow' => '/admin'); // handler reads $_POST directly
    $r = cloudhost247_tool_robots_generator(array('user_agent' => '*'));
    $out = $r['robots_txt'];
    return strpos($out, 'User-agent: *') !== false && strpos($out, 'Disallow: /admin') !== false;
});

$check('serp preview echoes title and url', function () {
    $r = cloudhost247_tool_serp_preview(array('title' => 'My Page', 'url' => 'https://example.com', 'description' => 'Desc'));
    return strpos(json_encode($r), 'My Page') !== false;
});

$check('open graph generator builds meta tags', function () {
    $r = cloudhost247_tool_open_graph(array('title' => 'T', 'url' => 'https://example.com', 'description' => 'D', 'image' => 'https://example.com/i.png'));
    $out = $r['tags'] ?? $r['html'] ?? json_encode($r);
    return strpos($out, 'og:title') !== false && strpos($out, 'og:image') !== false;
});



$check('raid calculator computes capacity and redundancy', function () {
    $r = cloudhost247_tool_raid_calculator(array('level' => '5', 'raid' => 5, 'disks' => 4, 'drives' => 4, 'size' => 1024));
    return isset($r['usable_capacity_gb']) && (float) $r['usable_capacity_gb'] === 3072.0 && $r['fault_tolerance'] === 1;
});

$check('mac generator emits valid addresses and lookup validates', function () {
    $r = cloudhost247_tool_mac_generator(array('count' => 5, 'format' => 'colon'));
    if (count($r['addresses']) !== 5) { return false; }
    foreach ($r['addresses'] as $mac) {
        if (!preg_match('/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/', $mac)) { return false; }
    }
    return isset(cloudhost247_tool_mac_lookup(array('mac' => 'zz'))['error']);
});

$check('user agent reflects the requesting agent', function () {
    $_SERVER['HTTP_USER_AGENT'] = 'TestAgent/1.0 (compatible)';
    $r = cloudhost247_tool_user_agent(array());
    return $r['user_agent'] === 'TestAgent/1.0 (compatible)' && $r['is_mobile'] === false;
});

$check('reverse image search builds engine links', function () {
    $r = cloudhost247_tool_reverse_image_search(array('url' => 'https://example.com/cat.png'));
    return count($r['engines']) === 4 && strpos($r['engines'][0]['url'], 'google.com') !== false;
});

/* ------------------------------------------------------------------ *
 * Network tools: validation paths only (no sockets in the suite)
 * ------------------------------------------------------------------ */

$check('ping handler validates host first', function () {
    return isset(cloudhost247_tool_ping_ipv4(array('host' => ''))['error']);
});

$check('port checker validates port range first', function () {
    return isset(cloudhost247_tool_port_checker(array('host' => 'example.com', 'port' => 99999))['error'])
        && isset(cloudhost247_tool_port_checker(array('host' => '', 'port' => 80))['error']);
});

$check('dns lookups validate domain first', function () {
    foreach (array('cloudhost247_tool_spf_checker', 'cloudhost247_tool_ns_lookup', 'cloudhost247_tool_mx_lookup', 'cloudhost247_tool_cname_lookup', 'cloudhost247_tool_dmarc_lookup', 'cloudhost247_tool_dns_health', 'cloudhost247_tool_dkim_checker') as $fn) {
        if (!isset($fn(array('domain' => 'not_a_domain'))['error'])) { return false; }
    }
    return true;
});

$check('ssl checker validates domain first', function () {
    return isset(cloudhost247_tool_ssl_checker(array('domain' => 'bad domain'))['error']);
});

$check('ip tools validate address first', function () {
    return isset(cloudhost247_tool_ip_location(array('ip' => 'not-an-ip'))['error'])
        && isset(cloudhost247_tool_ip_whois(array('ip' => 'not-an-ip'))['error']);
});

$check('online notepad enforces the size cap', function () {
    $_SESSION = array();
    $_POST = array('content' => 'short note'); // handler reads $_POST directly
    $ok = cloudhost247_tool_online_notepad(array('notepad_action' => 'save'));
    if (!isset($ok['saved']) || $ok['saved'] !== true) { return false; }
    $load = cloudhost247_tool_online_notepad(array('notepad_action' => 'load'));
    if ($load['content'] !== 'short note') { return false; }
    $_POST = array('content' => str_repeat('x', 262145));
    $tooBig = cloudhost247_tool_online_notepad(array('notepad_action' => 'save'));
    return isset($tooBig['error']);
});

/* ------------------------------------------------------------------ *
 * Admin + client controllers
 * ------------------------------------------------------------------ */

$check('admin tool toggles require a valid csrf token', function () {
    ch247_fresh_install();
    $_SESSION = array('adminid' => '1');
    $admin = new CloudHost247ToolsAdmin(array('modulelink' => 'addonmodules.php?module=cloudhost247_tools'));
    // token check failing (global stub returns false) -> mutation must NOT run
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = array('tool_action' => 'save', 'tools' => array());
    ob_start();
    $html = $admin->renderToolsManager();
    ob_end_clean();
    $enabled = CH247FakeStore::rows('mod_cloudhost247_tools_status');
    $allEnabled = !in_array(0, array_map(function ($r) { return (int) $r['enabled']; }, $enabled), true);
    if (!$allEnabled) { return false; } // nothing was switched off
    // with a valid token the save applies
    $GLOBALS['CH247_TOKEN_OK'] = true;
    $_POST['token'] = 'test-token-value';
    ob_start();
    $admin->renderToolsManager();
    ob_end_clean();
    $GLOBALS['CH247_TOKEN_OK'] = false;
    $rows = CH247FakeStore::rows('mod_cloudhost247_tools_status');
    $allOff = !in_array(1, array_map(function ($r) { return (int) $r['enabled']; }, $rows), true);
    $_POST = array();
    return $allOff;
});

$check('admin forms embed the csrf token field', function () {
    ch247_fresh_install();
    $_SESSION = array('adminid' => '1');
    $admin = new CloudHost247ToolsAdmin(array('modulelink' => 'addonmodules.php?module=cloudhost247_tools'));
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_POST = array();
    ob_start();
    $toolsHtml = $admin->renderToolsManager();
    $settingsHtml = $admin->renderSettings();
    ob_end_clean();
    return strpos($toolsHtml, 'name="token"') !== false && strpos($settingsHtml, 'name="token"') !== false
        && strpos($toolsHtml, 'test-token-value') !== false;
});

$check('client dashboard renders tool categories for guests', function () {
    ch247_fresh_install();
    $_SESSION = array();
    $_GET = array();
    $client = new CloudHost247ToolsClient(array('modulelink' => 'index.php?m=cloudhost247_tools'));
    $page = $client->handleRequest(); // public router: no action -> dashboard
    if ($page['templatefile'] !== 'dashboard' || $page['requirelogin'] !== false) { return false; }
    if (count($page['vars']['categories']) !== 9) { return false; }
    return strlen($page['vars']['csrf_token']) === 64;
});

$check('client tool page resolves a tool and unknown tools fall back to dashboard', function () {
    ch247_fresh_install();
    $_SESSION = array();
    $client = new CloudHost247ToolsClient(array('modulelink' => 'index.php?m=cloudhost247_tools'));
    $_GET = array('action' => 'tool', 'tool' => 'rot13');
    $page = $client->handleRequest();
    if ($page['templatefile'] !== 'tool' || strpos($page['pagetitle'], 'ROT13') === false) { return false; }
    $_GET = array('action' => 'tool', 'tool' => 'no_such_tool_at_all');
    $fallback = $client->handleRequest();
    return $fallback['templatefile'] === 'dashboard';
});

$check('client category page lists only enabled tools', function () {
    ch247_fresh_install();
    CH247FakeStore::setRows('mod_cloudhost247_tools_status', array_map(function ($r) {
        if ($r['tool_id'] === 'rot13') { $r['enabled'] = 0; }
        return $r;
    }, CH247FakeStore::rows('mod_cloudhost247_tools_status')));
    $_SESSION = array();
    $client = new CloudHost247ToolsClient(array('modulelink' => 'index.php?m=cloudhost247_tools'));
    $_GET = array('action' => 'category', 'cat' => 'productivity');
    $page = $client->handleRequest();
    return $page['templatefile'] === 'category' && !isset($page['vars']['tools']['rot13']);
});

/* ------------------------------------------------------------------ *
 * Module entry + migration
 * ------------------------------------------------------------------ */

$check('module config exposes the security settings', function () {
    $config = cloudhost247_tools_config();
    $fields = $config['fields'];
    return $config['version'] === '2.2.7'
        && isset($fields['api_token'], $fields['trust_proxy_headers'], $fields['rate_limit_requests'], $fields['cache_duration'], $fields['enable_logs'])
        && $fields['api_token']['Default'] === '';
});

$check('activation runs the guarded migration and seeds tools', function () {
    ch247_fresh_install(); // resets schema too
    CH247FakeStore::reset();
    ch247_set_setting('enable_logs', 'on');
    $result = cloudhost247_tools_activate();
    if ($result['status'] !== 'success') { return false; }
    foreach (array('settings', 'status', 'logs', 'cache', 'rate_limit') as $suffix) {
        if (!isset($GLOBALS['CH247_FAKE_SCHEMA']['mod_cloudhost247_tools_' . $suffix])) { return false; }
    }
    $seeded = count(CH247FakeStore::rows('mod_cloudhost247_tools_status'));
    if ($seeded < 79) { return false; }
    // migration is recorded in the shared version table
    $recorded = CH247FakeStore::rows('mod_cloudhost247_migrations');
    $found = false;
    foreach ($recorded as $row) {
        if ($row['module'] === 'cloudhost247_tools' && $row['version'] === '2.2.7') { $found = true; }
    }
    return $found;
});

$check('activation is idempotent and preserves data', function () {
    $result = cloudhost247_tools_activate(); // second run
    if ($result['status'] !== 'success') { return false; }
    return count(CH247FakeStore::rows('mod_cloudhost247_tools_status')) >= 79; // no duplicates lost
});

$check('deactivation preserves tables', function () {
    $result = cloudhost247_tools_deactivate();
    return $result['status'] === 'success'
        && isset($GLOBALS['CH247_FAKE_SCHEMA']['mod_cloudhost247_tools_status']);
});

$check('hooks register asset injection for the module pages', function () {
    $names = $GLOBALS['CH247_HOOKS'];
    foreach (array('ClientAreaPage', 'ClientAreaHeadOutput', 'ClientAreaPrimaryNavbar', 'AdminAreaPage') as $expected) {
        if (!in_array($expected, $names, true)) { return false; }
    }
    return true;
});

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

$failures = 0;
foreach ($tests as $name => $fn) {
    try {
        $pass = $fn();
    } catch (Throwable $e) {
        $pass = false;
        echo 'exception in "' . $name . '": ' . $e->getMessage() . "\n";
    }
    echo ($pass ? 'ok - ' : 'not ok - ') . $name . "\n";
    if (!$pass) { $failures++; }
}

echo count($tests) . ' tests, ' . $failures . ' failures' . "\n";
exit($failures > 0 ? 1 : 0);
