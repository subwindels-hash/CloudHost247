<?php
namespace CloudHost247\Integrations\Services;

use CloudHost247\Integrations\Registry\FieldDefinition;
use CloudHost247\Integrations\Registry\ProviderDefinition;
use CloudHost247\Integrations\Registry\ProviderRegistry;
use CloudHost247\Integrations\Security\SecretVault;
use CloudHost247\Integrations\Security\MasterKey;
use CloudHost247\Integrations\Security\UrlGuard;
use CloudHost247\Integrations\Support\Environment;
use CloudHost247\Integrations\Support\Redactor;
use CloudHost247\Integrations\Support\ResultCode;
use InvalidArgumentException;
use RuntimeException;
use WHMCS\Database\Capsule;

/**
 * Persistence for integration configuration, encrypted credentials and health
 * state.
 *
 * Plaintext credentials enter through save()/rotate() and leave only through
 * secrets(), which is called server-side by the client factory and the health
 * checker. No other method can return credential material.
 */
final class IntegrationRepository
{
    const TABLE = 'mod_cloudhost247_integrations';
    const SECRETS = 'mod_cloudhost247_integration_secrets';
    const EVENTS = 'mod_cloudhost247_integration_events';

    /** Sentinel written into the form so an unchanged secret is never resubmitted. */
    const KEEP_EXISTING = '';

    public function all($environment = null)
    {
        $query = Capsule::table(self::TABLE);
        if ($environment !== null) { $query->where('environment', Environment::assert($environment)); }
        return $query->orderBy('provider_key')->orderBy('environment')->get()->all();
    }

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findFor($providerKey, $environment)
    {
        return Capsule::table(self::TABLE)
            ->where('provider_key', $this->assertProvider($providerKey))
            ->where('environment', Environment::assert($environment))
            ->first();
    }

    /** Normalized, credential-free configuration array for a stored row. */
    public function configuration($row)
    {
        $options = array();
        if (!empty($row->options_json)) {
            $decoded = json_decode((string) $row->options_json, true);
            if (is_array($decoded)) { $options = $decoded; }
        }
        return array(
            'id' => (int) $row->id,
            'provider_key' => (string) $row->provider_key,
            'environment' => (string) $row->environment,
            'display_name' => (string) $row->display_name,
            'enabled' => (bool) $row->enabled,
            'base_url' => (string) $row->base_url,
            'api_version' => (string) $row->api_version,
            'account_id' => (string) $row->account_id,
            'region' => (string) $row->region,
            'username' => (string) $row->username,
            'timeout_seconds' => (int) $row->timeout_seconds,
            'connect_timeout_seconds' => (int) $row->connect_timeout_seconds,
            'retry_attempts' => (int) $row->retry_attempts,
            'retry_backoff_ms' => (int) $row->retry_backoff_ms,
            'options' => $options,
        );
    }

    /**
     * Decrypt the stored credentials of an integration for server-side use.
     *
     * @return array field key => plaintext (never persisted, never returned to a browser)
     */
    public function secrets($integrationId)
    {
        $plain = array();
        $rows = Capsule::table(self::SECRETS)->where('integration_id', (int) $integrationId)->get();
        foreach ($rows as $row) {
            $plain[(string) $row->field_key] = SecretVault::decrypt($row->envelope, array(
                'integration_id' => (int) $row->integration_id,
                'field_key' => (string) $row->field_key,
            ));
        }
        return $plain;
    }

    /** Masked metadata only: fingerprint and rotation timestamp, never a value. */
    public function secretMetadata($integrationId)
    {
        $meta = array();
        $rows = Capsule::table(self::SECRETS)->where('integration_id', (int) $integrationId)->get();
        foreach ($rows as $row) {
            $meta[(string) $row->field_key] = array(
                'fingerprint' => (string) $row->value_fingerprint,
                'key_fingerprint' => (string) $row->key_fingerprint,
                'rotated_at' => (string) $row->rotated_at,
                'masked' => Redactor::maskedSecret($row->value_fingerprint, $row->rotated_at),
                'stale_key' => (string) $row->key_fingerprint !== MasterKey::fingerprint(),
            );
        }
        return $meta;
    }

    /**
     * Create or update an integration.
     *
     * Existing credentials are preserved unless the administrator supplies a
     * replacement value for that specific field.
     *
     * @return array id, created, changed field keys, rotated secret keys
     */
    public function save($providerKey, $environment, array $input, $adminId = null)
    {
        $providerKey = $this->assertProvider($providerKey);
        $environment = Environment::assert($environment);
        $definition = ProviderRegistry::get($providerKey);
        $existing = $this->findFor($providerKey, $environment);

        $columns = $this->columnValues($definition, $input, $existing);
        $options = $this->optionValues($definition, $input, $existing);
        $now = date('Y-m-d H:i:s');

        $payload = array_merge($columns, array(
            'provider_key' => $providerKey,
            'environment' => $environment,
            'display_name' => $this->text(isset($input['display_name']) ? $input['display_name'] : $definition->label(), 128),
            'enabled' => !empty($input['enabled']) ? 1 : 0,
            'options_json' => json_encode($options),
            'updated_by' => $adminId ? (int) $adminId : null,
            'updated_at' => $now,
        ));

        if ($existing) {
            Capsule::table(self::TABLE)->where('id', (int) $existing->id)->update($payload);
            $id = (int) $existing->id;
            $created = false;
        } else {
            $payload['status'] = ResultCode::UNKNOWN;
            $payload['created_by'] = $adminId ? (int) $adminId : null;
            $payload['created_at'] = $now;
            $id = (int) Capsule::table(self::TABLE)->insertGetId($payload);
            $created = true;
        }

        $rotated = $this->storeSecrets($definition, $id, $environment, $input, $adminId);
        if ($rotated) {
            Capsule::table(self::TABLE)->where('id', $id)->update(array(
                'status' => ResultCode::UNKNOWN,
                'last_result_code' => null,
                'updated_at' => $now,
            ));
        }
        $this->assertRequiredFieldsPresent($definition, $id, $columns, $options);
        return array('id' => $id, 'created' => $created, 'rotated' => $rotated, 'changes' => $this->describe($definition, $columns, $options));
    }

    /** Replace exactly one credential (rotation) without touching configuration. */
    public function rotate($integrationId, $fieldKey, $value, $adminId = null)
    {
        $row = $this->find($integrationId);
        if (!$row) { throw new InvalidArgumentException('The integration no longer exists.'); }
        $definition = ProviderRegistry::get($row->provider_key);
        $field = $definition->field($fieldKey);
        if (!$field || !$field->isSecret()) { throw new InvalidArgumentException('That field is not a rotatable credential.'); }
        $value = (string) $value;
        if (trim($value) === '') { throw new InvalidArgumentException('A replacement credential is required.'); }
        $this->assertCredentialRule($definition, $field->key(), $value, (string) $row->environment);
        $this->writeSecret((int) $row->id, $field->key(), $value, $adminId);
        Capsule::table(self::TABLE)->where('id', (int) $row->id)->update(array(
            'status' => ResultCode::UNKNOWN,
            'last_result_code' => null,
            'updated_by' => $adminId ? (int) $adminId : null,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        return true;
    }

    public function setEnabled($integrationId, $enabled, $adminId = null)
    {
        Capsule::table(self::TABLE)->where('id', (int) $integrationId)->update(array(
            'enabled' => $enabled ? 1 : 0,
            'updated_by' => $adminId ? (int) $adminId : null,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        return true;
    }

    public function delete($integrationId)
    {
        $id = (int) $integrationId;
        Capsule::table(self::SECRETS)->where('integration_id', $id)->delete();
        Capsule::table(self::TABLE)->where('id', $id)->delete();
        return true;
    }

    /** Persist a health-check outcome. Only sanitized detail text is stored. */
    public function recordHealth($integrationId, array $result, $eventType = 'health_check', $adminId = null)
    {
        $id = (int) $integrationId;
        $row = $this->find($id);
        $code = ResultCode::isValid(isset($result['code']) ? $result['code'] : '') ? $result['code'] : ResultCode::UNKNOWN;
        $success = ResultCode::isSuccess($code);
        $now = date('Y-m-d H:i:s');
        $detail = Redactor::text(isset($result['detail']) ? $result['detail'] : ResultCode::label($code), 255);

        if ($row) {
            $update = array(
                'status' => $code,
                'last_result_code' => $code,
                'last_checked_at' => $now,
                'updated_at' => $now,
            );
            if ($success) {
                $update['last_success_at'] = $now;
                $update['last_failure_reason'] = null;
            } else {
                $update['last_failure_at'] = $now;
                $update['last_failure_reason'] = $detail;
            }
            Capsule::table(self::TABLE)->where('id', $id)->update($update);
        }

        Capsule::table(self::EVENTS)->insert(array(
            'integration_id' => $id ?: null,
            'provider_key' => $row ? (string) $row->provider_key : $this->text(isset($result['provider_key']) ? $result['provider_key'] : '', 64),
            'environment' => $row ? (string) $row->environment : $this->text(isset($result['environment']) ? $result['environment'] : '', 16),
            'event_type' => in_array($eventType, array('health_check', 'runtime_failure', 'configuration'), true) ? $eventType : 'health_check',
            'result_code' => $code,
            'outcome' => $success ? 'success' : 'failed',
            'latency_ms' => isset($result['latency_ms']) ? max(0, (int) $result['latency_ms']) : null,
            'detail' => $detail,
            'correlation_id' => isset($result['correlation_id']) && preg_match('/^[a-f0-9]{1,64}$/', (string) $result['correlation_id']) ? (string) $result['correlation_id'] : '',
            'admin_id' => $adminId ? (int) $adminId : null,
            'created_at' => $now,
        ));
        return $code;
    }

    /** Bounded, filtered event history for the dashboard. */
    public function events(array $filters = array(), $page = 1, $perPage = 25)
    {
        $page = max(1, (int) $page);
        $perPage = max(10, min(100, (int) $perPage));
        $query = Capsule::table(self::EVENTS);
        foreach (array('provider_key', 'environment', 'event_type', 'result_code', 'outcome') as $field) {
            if (!empty($filters[$field])) { $query->where($field, '=', substr((string) $filters[$field], 0, 64)); }
        }
        if (!empty($filters['integration_id'])) { $query->where('integration_id', (int) $filters['integration_id']); }
        $total = (clone $query)->count();
        $rows = $query->orderBy('id', 'desc')->offset(($page - 1) * $perPage)->limit($perPage)->get()->all();
        return array('rows' => $rows, 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / $perPage)), 'per_page' => $perPage);
    }

    /* ------------------------------------------------------------ internals */

    private function storeSecrets(ProviderDefinition $definition, $integrationId, $environment, array $input, $adminId)
    {
        $rotated = array();
        foreach ($definition->secretFields() as $field) {
            $key = $field->key();
            if (!array_key_exists($key, $input)) { continue; }
            $value = (string) $input[$key];
            if (trim($value) === self::KEEP_EXISTING) { continue; }
            $this->assertCredentialRule($definition, $key, $value, $environment);
            $this->writeSecret($integrationId, $key, $value, $adminId);
            $rotated[] = $key;
        }
        return $rotated;
    }

    private function writeSecret($integrationId, $fieldKey, $value, $adminId)
    {
        if (!SecretVault::available()) {
            throw new RuntimeException('Credential encryption is unavailable; configure ' . MasterKey::ENV_VARIABLE . ' before storing API credentials.');
        }
        $now = date('Y-m-d H:i:s');
        $envelope = SecretVault::encrypt($value, array('integration_id' => (int) $integrationId, 'field_key' => $fieldKey));
        $record = array(
            'envelope' => $envelope,
            'cipher' => SecretVault::CIPHER,
            'key_fingerprint' => MasterKey::fingerprint(),
            'value_fingerprint' => SecretVault::fingerprintValue($value),
            'rotated_by' => $adminId ? (int) $adminId : null,
            'rotated_at' => $now,
            'updated_at' => $now,
        );
        Capsule::table(self::SECRETS)->updateOrInsert(
            array('integration_id' => (int) $integrationId, 'field_key' => $fieldKey),
            $record
        );
    }

    private function columnValues(ProviderDefinition $definition, array $input, $existing)
    {
        $values = array(
            'base_url' => $existing ? (string) $existing->base_url : '',
            'api_version' => $existing ? (string) $existing->api_version : (string) $definition->defaultFor('api_version', ''),
            'account_id' => $existing ? (string) $existing->account_id : '',
            'region' => $existing ? (string) $existing->region : '',
            'username' => $existing ? (string) $existing->username : '',
        );
        foreach ($definition->fields() as $field) {
            if ($field->storage() !== FieldDefinition::STORAGE_COLUMN) { continue; }
            $key = $field->key();
            if (!array_key_exists($key, $input)) { continue; }
            $value = is_scalar($input[$key]) ? trim((string) $input[$key]) : '';
            if ($field->type() === FieldDefinition::TYPE_SELECT && $value !== '' && !array_key_exists($value, $field->options())) {
                throw new InvalidArgumentException('An unsupported value was submitted for "' . $field->label() . '".');
            }
            if ($field->type() === FieldDefinition::TYPE_URL && $value !== '') {
                $value = UrlGuard::normalizeBase($value, $definition->hostPolicy());
            }
            if ($field->pattern() !== '' && $value !== '' && !preg_match($field->pattern(), $value)) {
                throw new InvalidArgumentException('The value for "' . $field->label() . '" is not in the expected format.');
            }
            $values[$key] = $this->text($value, $field->maxLength());
        }
        $values['timeout_seconds'] = $this->bounded(isset($input['timeout_seconds']) ? $input['timeout_seconds'] : ($existing ? $existing->timeout_seconds : $definition->defaultFor('timeout_seconds', 20)), 1, 120, 20);
        $values['connect_timeout_seconds'] = $this->bounded(isset($input['connect_timeout_seconds']) ? $input['connect_timeout_seconds'] : ($existing ? $existing->connect_timeout_seconds : $definition->defaultFor('connect_timeout_seconds', 5)), 1, 30, 5);
        $values['retry_attempts'] = $this->bounded(isset($input['retry_attempts']) ? $input['retry_attempts'] : ($existing ? $existing->retry_attempts : 1), 1, 5, 1);
        $values['retry_backoff_ms'] = $this->bounded(isset($input['retry_backoff_ms']) ? $input['retry_backoff_ms'] : ($existing ? $existing->retry_backoff_ms : 250), 0, 5000, 250);
        if ($values['base_url'] === '' && $definition->defaultFor('base_url', '') !== '') {
            $values['base_url'] = (string) $definition->defaultFor('base_url', '');
        }
        return $values;
    }

    private function optionValues(ProviderDefinition $definition, array $input, $existing)
    {
        $options = array();
        if ($existing && !empty($existing->options_json)) {
            $decoded = json_decode((string) $existing->options_json, true);
            if (is_array($decoded)) { $options = $decoded; }
        }
        foreach ($definition->fields() as $field) {
            if ($field->storage() !== FieldDefinition::STORAGE_OPTION) { continue; }
            $key = $field->key();
            if (!array_key_exists($key, $input)) { continue; }
            $value = is_scalar($input[$key]) ? trim((string) $input[$key]) : '';
            if ($field->type() === FieldDefinition::TYPE_SELECT && $value !== '' && !array_key_exists($value, $field->options())) {
                throw new InvalidArgumentException('An unsupported value was submitted for "' . $field->label() . '".');
            }
            if ($field->type() === FieldDefinition::TYPE_NUMBER) {
                $options[$key] = $this->bounded($value, $field->minValue(), $field->maxLength(), (int) $field->defaultValue());
                continue;
            }
            $options[$key] = $this->text($value, $field->maxLength());
        }
        return $options;
    }

    private function assertRequiredFieldsPresent(ProviderDefinition $definition, $integrationId, array $columns, array $options)
    {
        $stored = array_keys($this->secretMetadata($integrationId));
        foreach ($definition->fields() as $field) {
            if (!$field->isRequired()) { continue; }
            if ($field->isSecret()) {
                if (!in_array($field->key(), $stored, true)) {
                    throw new InvalidArgumentException('"' . $field->label() . '" is required for this integration.');
                }
                continue;
            }
            $bag = $field->storage() === FieldDefinition::STORAGE_COLUMN ? $columns : $options;
            if (!isset($bag[$field->key()]) || trim((string) $bag[$field->key()]) === '') {
                throw new InvalidArgumentException('"' . $field->label() . '" is required for this integration.');
            }
        }
    }

    /**
     * Enforce the provider's test/production credential separation rules so a
     * sandbox key can never be saved as a production credential (or the
     * reverse).
     */
    private function assertCredentialRule(ProviderDefinition $definition, $fieldKey, $value, $environment)
    {
        $rules = $definition->credentialRules();
        if (empty($rules[$fieldKey]) || !is_array($rules[$fieldKey])) { return; }
        $rule = $rules[$fieldKey];
        $isProduction = Environment::isProduction($environment);
        $requires = $isProduction
            ? (isset($rule['production_requires_prefix']) ? $rule['production_requires_prefix'] : null)
            : (isset($rule['non_production_requires_prefix']) ? $rule['non_production_requires_prefix'] : null);
        if ($requires !== null && strpos($value, (string) $requires) !== 0) {
            throw new InvalidArgumentException('This credential does not match the ' . $environment . ' key format required by ' . $definition->label() . '.');
        }
        $forbids = $isProduction
            ? (isset($rule['production_forbids_substring']) ? $rule['production_forbids_substring'] : null)
            : (isset($rule['non_production_forbids_substring']) ? $rule['non_production_forbids_substring'] : null);
        if ($forbids !== null && strpos($value, (string) $forbids) !== false) {
            throw new InvalidArgumentException('This credential looks like it belongs to a different environment and was not saved.');
        }
    }

    private function describe(ProviderDefinition $definition, array $columns, array $options)
    {
        $changes = array();
        foreach ($columns as $key => $value) { $changes[$key] = $value; }
        foreach ($options as $key => $value) { $changes['option.' . $key] = $value; }
        return $changes;
    }

    private function assertProvider($providerKey)
    {
        $providerKey = (string) $providerKey;
        if (!ProviderRegistry::has($providerKey)) {
            throw new InvalidArgumentException('Unknown integration provider.');
        }
        return $providerKey;
    }

    private function text($value, $limit)
    {
        $value = preg_replace('/[\x00-\x1f\x7f]/', '', (string) $value);
        return substr(trim($value), 0, max(1, (int) $limit));
    }

    private function bounded($value, $min, $max, $fallback)
    {
        if ($value === '' || $value === null || !is_numeric($value)) { return (int) $fallback; }
        return max((int) $min, min((int) $max, (int) $value));
    }
}
