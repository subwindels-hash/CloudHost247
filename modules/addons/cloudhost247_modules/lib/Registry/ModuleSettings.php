<?php
namespace CloudHost247\ModuleManager\Registry;

use CloudHost247\ModuleManager\Manifest\Manifest;
use CloudHost247\ModuleManager\Support\ModuleException;

/**
 * Validation of the non-secret settings a module declares in its manifest.
 *
 * The Module Manager stores operational settings such as a timeout or a
 * default region. It deliberately cannot store credentials: the manifest
 * parser rejects secret fields, and anything that looks like a credential key
 * is refused there too, so an API key can only ever live in the encrypted
 * API & Integrations vault.
 *
 * Input is accepted only for keys the installed manifest declares. Anything
 * else posted to the form is discarded rather than stored.
 */
final class ModuleSettings
{
    const MAX_VALUE_LENGTH = 512;

    /**
     * @param Manifest $manifest installed manifest, the single source of truth for allowed keys
     * @param array    $input    raw request input
     * @return array array('values' => array<string,string>, 'ignored' => string[])
     * @throws ModuleException when a declared field fails its own rules
     */
    public static function validate(Manifest $manifest, array $input)
    {
        $fields = $manifest->configuration()['fields'];
        $values = array();
        $declared = array();

        foreach ($fields as $field) {
            $key = $field['key'];
            $declared[$key] = true;
            $raw = isset($input[$key]) ? $input[$key] : null;

            if ($field['type'] === 'boolean') {
                $values[$key] = self::truthy($raw) ? '1' : '0';
                continue;
            }

            $value = is_scalar($raw) ? trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string) $raw)) : '';
            if ($value === '') {
                if (!empty($field['required'])) {
                    throw new ModuleException(
                        'The setting "' . $field['label'] . '" is required.',
                        ModuleException::REASON_CONFIGURATION
                    );
                }
                $values[$key] = '';
                continue;
            }
            if (strlen($value) > self::MAX_VALUE_LENGTH) {
                throw new ModuleException(
                    'The setting "' . $field['label'] . '" is longer than ' . self::MAX_VALUE_LENGTH . ' characters.',
                    ModuleException::REASON_CONFIGURATION
                );
            }
            $values[$key] = self::validateValue($field, $value);
        }

        $ignored = array();
        foreach (array_keys($input) as $key) {
            if (!isset($declared[$key])) { $ignored[] = (string) $key; }
        }

        return array('values' => $values, 'ignored' => $ignored);
    }

    /** Defaults declared by the manifest, used before an administrator saves anything. */
    public static function defaults(Manifest $manifest)
    {
        $values = array();
        foreach ($manifest->configuration()['fields'] as $field) {
            $values[$field['key']] = (string) $field['default'];
        }
        return $values;
    }

    /** Stored values merged over the manifest defaults. */
    public static function effective(Manifest $manifest, array $stored)
    {
        $values = self::defaults($manifest);
        foreach ($values as $key => $default) {
            if (array_key_exists($key, $stored)) { $values[$key] = (string) $stored[$key]; }
        }
        return $values;
    }

    /* ----------------------------------------------------------- internals */

    private static function validateValue(array $field, $value)
    {
        if ($field['type'] === 'number') {
            if (!is_numeric($value)) {
                throw new ModuleException('The setting "' . $field['label'] . '" must be a number.', ModuleException::REASON_CONFIGURATION);
            }
            $number = $value + 0;
            if ($field['min'] !== '' && $number < $field['min'] + 0) {
                throw new ModuleException('The setting "' . $field['label'] . '" must be ' . $field['min'] . ' or more.', ModuleException::REASON_CONFIGURATION);
            }
            if ($field['max'] !== '' && $number > $field['max'] + 0) {
                throw new ModuleException('The setting "' . $field['label'] . '" must be ' . $field['max'] . ' or less.', ModuleException::REASON_CONFIGURATION);
            }
            return (string) $value;
        }

        if ($field['type'] === 'select') {
            if (!in_array($value, $field['options'], true)) {
                throw new ModuleException('The setting "' . $field['label'] . '" is not one of the values this module allows.', ModuleException::REASON_CONFIGURATION);
            }
            return $value;
        }

        return $value;
    }

    private static function truthy($value)
    {
        if (is_bool($value)) { return $value; }
        if (!is_scalar($value)) { return false; }
        return in_array(strtolower(trim((string) $value)), array('1', 'true', 'yes', 'on'), true);
    }
}
