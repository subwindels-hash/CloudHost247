<?php
namespace CloudHost247\Marketing\Domain;

/** Closed set of subscriber provenance values (schema: subscribers.source). */
final class SubscriberSource
{
    const MANUAL = 'manual';
    const IMPORT = 'import';
    const WHMCS_CLIENT = 'whmcs_client';
    const API = 'api';
    const FORM = 'form';

    private static $labels = array(
        self::MANUAL => 'Added by administrator',
        self::IMPORT => 'Imported',
        self::WHMCS_CLIENT => 'WHMCS client record',
        self::API => 'API / integration',
        self::FORM => 'Sign-up form',
    );

    public static function all() { return array_keys(self::$labels); }

    public static function label($source)
    {
        $source = (string) $source;
        return isset(self::$labels[$source]) ? self::$labels[$source] : 'Unknown';
    }

    public static function isValid($source) { return isset(self::$labels[(string) $source]); }
}
