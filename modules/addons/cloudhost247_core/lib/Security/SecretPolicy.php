<?php
namespace CloudHost247\Foundation\Security;

use RuntimeException;

final class SecretPolicy
{
    private static $keys = array('password', 'secret', 'consumerkey', 'consumer_key', 'applicationsecret', 'token', 'authorization', 'apikey', 'api_key');

    public static function redact(array $data)
    {
        $out = array();
        foreach ($data as $key => $value) {
            $normal = strtolower(str_replace(array('-', ' '), '_', (string) $key));
            $sensitive = false;
            foreach (self::$keys as $needle) { if (strpos($normal, $needle) !== false) { $sensitive = true; break; } }
            if ($sensitive) { $out[$key] = '[REDACTED]'; }
            elseif (is_array($value)) { $out[$key] = self::redact($value); }
            else { $out[$key] = $value; }
        }
        return $out;
    }

    public static function assertServerCredentialStorage($params)
    {
        if (!is_array($params) || empty($params['serverpassword'])) {
            throw new RuntimeException('Store API credentials in the WHMCS encrypted server password field.');
        }
    }
}
