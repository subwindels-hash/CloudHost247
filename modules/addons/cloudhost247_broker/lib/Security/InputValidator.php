<?php
namespace CloudHost247\Broker\Security;

use InvalidArgumentException;

/** Centralized, strict validation for every value that reaches the broker engine. */
final class InputValidator
{
    private static $currencies = array('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NGN', 'INR', 'ZAR');

    public static function domain($domain)
    {
        $domain = strtolower(trim((string) $domain));
        $domain = preg_replace('#^https?://#', '', $domain);
        $domain = preg_replace('#^www\.#', '', $domain);
        if (!preg_match('/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $domain)) {
            throw new InvalidArgumentException('Enter a valid domain name, for example example.com.');
        }
        return $domain;
    }

    public static function money($value, $label = 'Amount')
    {
        if (!is_numeric($value)) { throw new InvalidArgumentException($label . ' must be a number.'); }
        $value = round((float) $value, 2);
        if ($value < 0 || $value > 100000000) { throw new InvalidArgumentException($label . ' is out of range.'); }
        return $value;
    }

    public static function currency($value)
    {
        $value = strtoupper(trim((string) $value));
        if (!in_array($value, self::$currencies, true)) {
            throw new InvalidArgumentException('Unsupported currency.');
        }
        return $value;
    }

    public static function supportedCurrencies() { return self::$currencies; }

    public static function shortText($value, $max = 191, $label = 'Value')
    {
        $value = trim(strip_tags((string) $value));
        if (mb_strlen($value) > $max) { $value = mb_substr($value, 0, $max); }
        return $value;
    }

    public static function longText($value, $max = 4000)
    {
        $value = trim(strip_tags((string) $value));
        if (mb_strlen($value) > $max) { $value = mb_substr($value, 0, $max); }
        return $value;
    }

    public static function futureDate($value)
    {
        $value = trim((string) $value);
        if ($value === '') { return null; }
        $timestamp = strtotime($value);
        if ($timestamp === false || $timestamp <= time()) {
            throw new InvalidArgumentException('The deadline must be a valid future date.');
        }
        return date('Y-m-d H:i:s', $timestamp);
    }

    public static function idempotencyKey($value)
    {
        $value = trim((string) $value);
        if ($value === '') { return null; }
        if (!preg_match('/^[A-Za-z0-9_\-\.:]{8,80}$/', $value)) {
            throw new InvalidArgumentException('Invalid idempotency key.');
        }
        return $value;
    }
}
