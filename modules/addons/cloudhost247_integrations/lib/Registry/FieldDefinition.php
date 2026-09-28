<?php
namespace CloudHost247\Integrations\Registry;

use InvalidArgumentException;

/**
 * One configurable field of an integration.
 *
 * Only fields a provider genuinely requires are declared, so each integration
 * screen shows exactly the credentials and settings that provider uses.
 */
final class FieldDefinition
{
    const TYPE_TEXT = 'text';
    const TYPE_SECRET = 'secret';
    const TYPE_URL = 'url';
    const TYPE_SELECT = 'select';
    const TYPE_NUMBER = 'number';
    const TYPE_BOOLEAN = 'boolean';

    /** Persisted on the integration row itself (never a credential). */
    const STORAGE_COLUMN = 'column';
    /** Persisted in the non-secret JSON options bag on the integration row. */
    const STORAGE_OPTION = 'option';
    /** Persisted encrypted in the credential table. */
    const STORAGE_SECRET = 'secret';

    /** Columns an integration definition may bind a field to. */
    private static $columns = array(
        'base_url', 'api_version', 'account_id', 'region', 'username',
        'timeout_seconds', 'connect_timeout_seconds', 'retry_attempts', 'retry_backoff_ms',
    );

    private $data;

    private function __construct(array $data)
    {
        $this->data = $data;
    }

    public static function fromArray(array $field)
    {
        $key = isset($field['key']) ? (string) $field['key'] : '';
        if (!preg_match('/^[a-z][a-z0-9_]{1,63}$/', $key)) {
            throw new InvalidArgumentException('Invalid integration field key.');
        }
        $type = isset($field['type']) ? (string) $field['type'] : self::TYPE_TEXT;
        $storage = isset($field['storage']) ? (string) $field['storage'] : ($type === self::TYPE_SECRET ? self::STORAGE_SECRET : self::STORAGE_OPTION);
        if (!in_array($type, array(self::TYPE_TEXT, self::TYPE_SECRET, self::TYPE_URL, self::TYPE_SELECT, self::TYPE_NUMBER, self::TYPE_BOOLEAN), true)) {
            throw new InvalidArgumentException('Invalid integration field type.');
        }
        if (!in_array($storage, array(self::STORAGE_COLUMN, self::STORAGE_OPTION, self::STORAGE_SECRET), true)) {
            throw new InvalidArgumentException('Invalid integration field storage.');
        }
        if ($type === self::TYPE_SECRET && $storage !== self::STORAGE_SECRET) {
            throw new InvalidArgumentException('Secret fields must use encrypted storage.');
        }
        if ($storage === self::STORAGE_SECRET && $type !== self::TYPE_SECRET) {
            throw new InvalidArgumentException('Encrypted storage is reserved for secret fields.');
        }
        if ($storage === self::STORAGE_COLUMN && !in_array($key, self::$columns, true)) {
            throw new InvalidArgumentException('Unknown integration column binding: ' . $key);
        }
        return new self(array(
            'key' => $key,
            'label' => isset($field['label']) ? (string) $field['label'] : $key,
            'type' => $type,
            'storage' => $storage,
            'required' => !empty($field['required']),
            'help' => isset($field['help']) ? (string) $field['help'] : '',
            'options' => isset($field['options']) && is_array($field['options']) ? $field['options'] : array(),
            'pattern' => isset($field['pattern']) ? (string) $field['pattern'] : '',
            'default' => isset($field['default']) ? $field['default'] : '',
            'max' => isset($field['max']) ? (int) $field['max'] : 191,
            'min' => isset($field['min']) ? (int) $field['min'] : 0,
        ));
    }

    public function key() { return $this->data['key']; }
    public function label() { return $this->data['label']; }
    public function type() { return $this->data['type']; }
    public function storage() { return $this->data['storage']; }
    public function isRequired() { return $this->data['required']; }
    public function isSecret() { return $this->data['storage'] === self::STORAGE_SECRET; }
    public function help() { return $this->data['help']; }
    public function options() { return $this->data['options']; }
    public function pattern() { return $this->data['pattern']; }
    public function defaultValue() { return $this->data['default']; }
    public function maxLength() { return $this->data['max']; }
    public function minValue() { return $this->data['min']; }

    public static function columns() { return self::$columns; }
}
