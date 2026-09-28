<?php
namespace CloudHost247\Foundation\Support;

final class HealthCheck
{
    public static function run()
    {
        return array(
            'php_supported' => version_compare(PHP_VERSION, '7.4.0', '>='),
            'whmcs_loaded' => defined('WHMCS'),
            'capsule_available' => class_exists('WHMCS\\Database\\Capsule'),
            'curl_available' => extension_loaded('curl'),
            'json_available' => extension_loaded('json'),
            'openssl_available' => extension_loaded('openssl'),
            'random_bytes_available' => function_exists('random_bytes'),
        );
    }
}
