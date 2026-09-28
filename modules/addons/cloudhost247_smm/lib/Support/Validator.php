<?php
namespace CloudHost247\Smm\Support;

use RuntimeException;

/**
 * Target-link and quantity validation shared by provisioning, the client area
 * and administrator tools. Centralised so the rules cannot drift.
 */
final class Validator
{
    /**
     * @param string $link
     * @return string normalized link
     * @throws RuntimeException
     */
    public static function targetLink($link)
    {
        return UrlPolicy::assertPublicTargetLink($link);
    }

    /**
     * @param mixed $quantity
     * @param int|null $min provider minimum (null = unknown, provider will enforce)
     * @param int|null $max provider maximum (null = unknown)
     * @return int validated quantity
     * @throws RuntimeException
     */
    public static function quantity($quantity, $min = null, $max = null)
    {
        if (is_string($quantity)) {
            $quantity = trim($quantity);
        }
        if (!is_numeric($quantity) || (string) (int) $quantity !== (string) $quantity
            && !(is_int($quantity) || (is_string($quantity) && preg_match('/^-?\d+$/', $quantity)))) {
            throw new RuntimeException('Quantity must be a whole number.');
        }
        $value = (int) $quantity;
        if ($value < 1) {
            throw new RuntimeException('Quantity must be at least 1.');
        }
        if ($value > 1000000000) {
            throw new RuntimeException('Quantity is unrealistically large.');
        }
        if ($min !== null && $value < (int) $min) {
            throw new RuntimeException('Quantity is below the provider minimum of ' . (int) $min . '.');
        }
        if ($max !== null && $value > (int) $max) {
            throw new RuntimeException('Quantity is above the provider maximum of ' . (int) $max . '.');
        }
        return $value;
    }

    /** Bounded, printable admin note (letters, digits, basic punctuation). */
    public static function note($note, $maxLength = 300)
    {
        $note = trim(strip_tags((string) $note));
        if (strlen($note) > $maxLength) {
            $note = substr($note, 0, $maxLength);
        }
        return $note;
    }

    /** Provider service id: non-empty printable token. */
    public static function providerServiceId($id)
    {
        $id = trim((string) $id);
        if ($id === '' || strlen($id) > 64 || !preg_match('/^[A-Za-z0-9._-]+$/', $id)) {
            throw new RuntimeException('Provider service id must be 1-64 characters (letters, digits, dot, dash, underscore).');
        }
        return $id;
    }
}
