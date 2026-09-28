<?php
namespace CloudHost247\Integrations\Registry;

use InvalidArgumentException;

/**
 * Declarative description of one supported provider.
 *
 * A definition is the single source of truth for a provider's configuration
 * screen, credential storage, endpoint policy, authentication strategy and
 * connection test. Adding a provider means adding a definition — no dashboard,
 * schema or controller change is required.
 */
final class ProviderDefinition
{
    /** Base URL resolution modes. */
    const BASE_FIXED = 'fixed';       // pinned provider URL, not administrator editable
    const BASE_REGION = 'region';     // chosen from a documented region map
    const BASE_ENVIRONMENT = 'environment'; // documented production / sandbox hosts
    const BASE_ADMIN = 'admin';       // self-hosted endpoint supplied by the administrator

    private $data;
    private $fields = array();

    private function __construct(array $data)
    {
        $this->data = $data;
    }

    public static function fromArray(array $definition)
    {
        $key = isset($definition['key']) ? (string) $definition['key'] : '';
        if (!preg_match('/^[a-z][a-z0-9_]{1,63}$/', $key)) {
            throw new InvalidArgumentException('Invalid provider key.');
        }
        foreach (array('label', 'category', 'vendor', 'auth', 'health', 'base_url') as $required) {
            if (!isset($definition[$required])) {
                throw new InvalidArgumentException('Provider "' . $key . '" is missing "' . $required . '".');
            }
        }
        $base = (array) $definition['base_url'];
        $mode = isset($base['mode']) ? (string) $base['mode'] : self::BASE_FIXED;
        if (!in_array($mode, array(self::BASE_FIXED, self::BASE_REGION, self::BASE_ENVIRONMENT, self::BASE_ADMIN), true)) {
            throw new InvalidArgumentException('Provider "' . $key . '" declares an unknown base URL mode.');
        }
        $health = (array) $definition['health'];
        if (empty($health['method']) || !isset($health['path'])) {
            throw new InvalidArgumentException('Provider "' . $key . '" must declare a real connection test.');
        }
        $instance = new self(array(
            'key' => $key,
            'label' => (string) $definition['label'],
            'category' => (string) $definition['category'],
            'capabilities' => isset($definition['capabilities']) ? array_values((array) $definition['capabilities']) : array(),
            'vendor' => (string) $definition['vendor'],
            'summary' => isset($definition['summary']) ? (string) $definition['summary'] : '',
            'documentation' => isset($definition['documentation']) ? (string) $definition['documentation'] : '',
            'credentials_url' => isset($definition['credentials_url']) ? (string) $definition['credentials_url'] : '',
            'scopes' => isset($definition['scopes']) ? array_values((array) $definition['scopes']) : array(),
            'used_by' => isset($definition['used_by']) ? array_values((array) $definition['used_by']) : array(),
            'auth' => (array) $definition['auth'],
            'health' => $health,
            'base_url' => array_merge(array('mode' => $mode), $base),
            'host_policy' => isset($definition['host_policy']) ? (array) $definition['host_policy'] : array(),
            'defaults' => isset($definition['defaults']) ? (array) $definition['defaults'] : array(),
            'credential_rules' => isset($definition['credential_rules']) ? (array) $definition['credential_rules'] : array(),
            'notes' => isset($definition['notes']) ? (string) $definition['notes'] : '',
        ));
        foreach (isset($definition['fields']) ? (array) $definition['fields'] : array() as $field) {
            $instance->fields[] = FieldDefinition::fromArray((array) $field);
        }
        return $instance;
    }

    public function key() { return $this->data['key']; }
    public function label() { return $this->data['label']; }
    public function category() { return $this->data['category']; }
    public function capabilities() { return $this->data['capabilities']; }
    public function vendor() { return $this->data['vendor']; }
    public function summary() { return $this->data['summary']; }
    public function documentation() { return $this->data['documentation']; }
    public function credentialsUrl() { return $this->data['credentials_url']; }
    public function scopes() { return $this->data['scopes']; }
    public function usedBy() { return $this->data['used_by']; }
    public function auth() { return $this->data['auth']; }
    public function authType() { return isset($this->data['auth']['type']) ? (string) $this->data['auth']['type'] : 'none'; }
    public function health() { return $this->data['health']; }
    public function hostPolicy() { return $this->data['host_policy']; }
    public function credentialRules() { return $this->data['credential_rules']; }
    public function notes() { return $this->data['notes']; }
    public function baseUrlMode() { return $this->data['base_url']['mode']; }
    public function baseUrlSpec() { return $this->data['base_url']; }

    /** @return FieldDefinition[] */
    public function fields() { return $this->fields; }

    /** @return FieldDefinition|null */
    public function field($key)
    {
        foreach ($this->fields as $field) { if ($field->key() === $key) { return $field; } }
        return null;
    }

    /** @return FieldDefinition[] */
    public function secretFields()
    {
        $secrets = array();
        foreach ($this->fields as $field) { if ($field->isSecret()) { $secrets[] = $field; } }
        return $secrets;
    }

    public function defaultFor($key, $fallback = '')
    {
        return isset($this->data['defaults'][$key]) ? $this->data['defaults'][$key] : $fallback;
    }

    public function requiresAdministratorEndpoint()
    {
        return $this->baseUrlMode() === self::BASE_ADMIN;
    }

    /**
     * Resolve the provider base URL for an integration row.
     *
     * @param array $config normalized integration configuration
     */
    public function resolveBaseUrl(array $config)
    {
        $spec = $this->data['base_url'];
        switch ($spec['mode']) {
            case self::BASE_FIXED:
                return (string) $spec['url'];
            case self::BASE_REGION:
                $region = isset($config['region']) ? strtolower((string) $config['region']) : '';
                if ($region === '' || !isset($spec['map'][$region])) {
                    throw new InvalidArgumentException('A supported region must be selected for ' . $this->label() . '.');
                }
                return (string) $spec['map'][$region];
            case self::BASE_ENVIRONMENT:
                $environment = isset($config['environment']) ? (string) $config['environment'] : 'production';
                if (!isset($spec['map'][$environment])) {
                    throw new InvalidArgumentException('No documented endpoint exists for this environment.');
                }
                return (string) $spec['map'][$environment];
            default:
                $url = isset($config['base_url']) ? (string) $config['base_url'] : '';
                if ($url === '') {
                    throw new InvalidArgumentException('An API base URL is required for ' . $this->label() . '.');
                }
                return $url;
        }
    }

    public function toArray()
    {
        $fields = array();
        foreach ($this->fields as $field) {
            $fields[] = array('key' => $field->key(), 'label' => $field->label(), 'type' => $field->type(), 'storage' => $field->storage(), 'required' => $field->isRequired());
        }
        return array_merge($this->data, array('fields' => $fields));
    }
}
