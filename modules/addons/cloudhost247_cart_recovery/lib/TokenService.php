<?php
namespace CloudHost247\CartRecovery;
final class TokenService {
    public static function generate() { return bin2hex(random_bytes(32)); }
    public static function hash($token) { return hash('sha256',(string)$token); }
    public static function valid($token) { return is_string($token) && preg_match('/^[a-f0-9]{64}$/D',$token); }
    // The database stores a one-way hash for lookup. WHMCS's encrypted value is
    // retained only so a later cron can construct the URL; it is never rendered or logged.
    public static function seal($token) { return function_exists('encrypt') ? encrypt($token) : base64_encode($token); }
    public static function open($sealed) { return function_exists('decrypt') ? decrypt($sealed) : base64_decode($sealed,true); }
}
