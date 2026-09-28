<?php
namespace CloudHost247\Integrations\Services;

use CloudHost247\Integrations\Registry\FieldDefinition;
use CloudHost247\Integrations\Registry\ProviderDefinition;
use CloudHost247\Integrations\Registry\ProviderRegistry;
use CloudHost247\Integrations\Support\Environment;
use CloudHost247\Integrations\Support\ResultCode;

/**
 * Server-rendered administration UI for the API & Integrations centre.
 *
 * The view never receives a decrypted credential: secret inputs are always
 * empty and stored credentials are represented by a fingerprint mask. No
 * JavaScript is emitted, so no credential can reach a browser script.
 */
final class AdminView
{
    private $link;

    public function __construct($moduleLink)
    {
        $this->link = (string) $moduleLink;
    }

    public function render(array $data)
    {
        $html = $this->header($data);
        switch ($data['view']) {
            case 'configure':
                $html .= isset($data['provider']) ? $this->configure($data) : $this->dashboard($data);
                break;
            case 'catalog':
                $html .= $this->catalog($data);
                break;
            case 'events':
                $html .= $this->events($data);
                break;
            default:
                $html .= $this->dashboard($data);
        }
        return $html . $this->footer();
    }

    /* ------------------------------------------------------------- chrome */

    private function header(array $data)
    {
        $environment = $data['environment'];
        $html = '<h2>API &amp; Integrations</h2>'
            . '<p>Single control centre for every external API this platform calls. Credentials are encrypted at rest, decrypted only on the server at call time, and never rendered back into this page.</p>';

        $html .= $this->environmentBanner($data);
        if (!$data['vault_ready']) {
            $html .= '<div class="alert alert-danger"><strong>Credential encryption is not available.</strong> Set the <code>' . $this->e($data['key_variable'])
                . '</code> environment variable (32+ random bytes) on this server before storing API credentials. Until then integrations cannot be saved or used. Current key source: '
                . $this->e($data['vault_source']) . '.</div>';
        } else {
            $html .= '<p class="text-muted">Credential encryption: AES-256-GCM, key source <strong>' . $this->e($data['vault_source']) . '</strong>.</p>';
        }
        if ($data['notice']) { $html .= '<div class="alert alert-success">' . $this->e($data['notice']) . '</div>'; }
        if ($data['error']) { $html .= '<div class="alert alert-danger">' . $this->e($data['error']) . '</div>'; }
        if (!empty($data['test'])) { $html .= $this->testResult($data['test']); }

        $html .= '<ul class="nav nav-tabs" role="tablist">';
        foreach (array('dashboard' => 'Health dashboard', 'catalog' => 'Supported integrations', 'events' => 'Connection events') as $view => $label) {
            $active = $data['view'] === $view || ($view === 'dashboard' && $data['view'] === 'configure') ? ' class="active"' : '';
            $html .= '<li role="presentation"' . $active . '><a href="' . $this->url(array('view' => $view, 'environment' => $environment)) . '">' . $this->e($label) . '</a></li>';
        }
        $html .= '</ul><br>';

        $html .= '<form method="get" class="form-inline" aria-label="Environment selector">' . $this->getContext(array('view' => $data['view']))
            . '<label>Environment <select class="form-control" name="environment">';
        foreach ($data['environments'] as $candidate) {
            $html .= '<option value="' . $this->e($candidate) . '"' . ($candidate === $environment ? ' selected' : '') . '>' . $this->e(ucfirst($candidate)) . '</option>';
        }
        $html .= '</select></label> <button class="btn btn-default">Switch environment</button></form><hr>';
        return $html;
    }

    private function environmentBanner(array $data)
    {
        $viewing = $data['environment'];
        $active = $data['active_environment'];
        $class = Environment::isProduction($viewing) ? 'alert-danger' : 'alert-info';
        $html = '<div class="alert ' . $class . '"><strong>Viewing environment: ' . strtoupper($this->e($viewing)) . '.</strong> '
            . 'This deployment reports itself as <strong>' . strtoupper($this->e($active)) . '</strong> (source: ' . $this->e($data['environment_source']) . ').';
        if (!$data['environment_explicit']) {
            $html .= ' <em>' . $this->e(Environment::ENV_VARIABLE) . ' is not set, so the safest assumption (production) is being used. Set it explicitly on development and staging servers.</em>';
        }
        if ($viewing !== $active) {
            $html .= ' <strong>You are editing credentials for a different environment than the one this server runs in.</strong> Only ' . strtoupper($this->e($active)) . ' credentials are used at runtime here.';
        }
        if (Environment::isProduction($viewing)) {
            $html .= ' Saving, enabling, rotating or testing a production integration requires an explicit confirmation on every submission.';
        }
        return $html . '</div>';
    }

    private function testResult(array $test)
    {
        $success = ResultCode::isSuccess($test['code']);
        return '<div class="alert ' . ($success ? 'alert-success' : 'alert-warning') . '"><strong>Connection test: ' . $this->e(ResultCode::label($test['code'])) . '.</strong> '
            . $this->e(isset($test['detail']) ? $test['detail'] : '')
            . ' <span class="text-muted">Latency ' . (int) (isset($test['latency_ms']) ? $test['latency_ms'] : 0) . ' ms · reference ' . $this->e(isset($test['correlation_id']) ? $test['correlation_id'] : '') . '</span></div>';
    }

    private function footer()
    {
        return '<hr><p class="text-muted">Result classifications are deliberately coarse. Raw provider responses, credentials, request headers and stack traces are never shown here or written to the log; use the reference identifier with the CloudHost247 audit log to correlate an event.</p>';
    }

    /* ---------------------------------------------------------- dashboard */

    private function dashboard(array $data)
    {
        $grouped = array();
        foreach ($data['overview'] as $row) { $grouped[$row['definition']->category()][] = $row; }
        $configured = 0;
        $healthy = 0;
        foreach ($data['overview'] as $row) {
            if ($row['configured']) { $configured++; }
            if ($row['status'] === ResultCode::CONNECTED) { $healthy++; }
        }
        $html = '<h3>Health dashboard</h3><p><strong>' . (int) $configured . '</strong> of ' . count($data['overview'])
            . ' registered integrations are configured for ' . $this->e($data['environment']) . '; <strong>' . (int) $healthy
            . '</strong> reported a successful connection on their last verified test. Integrations that have never been tested are shown as NOT VERIFIED — no status on this page is simulated.</p>';

        foreach ($data['categories'] as $category => $label) {
            if (empty($grouped[$category])) { continue; }
            $html .= '<h4>' . $this->e($label) . '</h4><table class="table table-striped"><thead><tr>'
                . '<th>Integration</th><th>Status</th><th>Environment</th><th>Last check</th><th>Last success</th><th>Last failure</th><th>Actions</th>'
                . '</tr></thead><tbody>';
            foreach ($grouped[$category] as $row) { $html .= $this->dashboardRow($row, $data); }
            $html .= '</tbody></table>';
        }
        return $html;
    }

    private function dashboardRow(array $row, array $data)
    {
        $definition = $row['definition'];
        $html = '<tr><td><strong>' . $this->e($row['display_name']) . '</strong><br><span class="text-muted">' . $this->e($definition->vendor()) . ' · ' . $this->e($definition->key()) . '</span></td>'
            . '<td><span class="label ' . $this->statusClass($row['status']) . '">' . $this->e($row['status_label']) . '</span>'
            . ($row['configured'] && !$row['enabled'] ? ' <span class="label label-default">DISABLED</span>' : '') . '</td>'
            . '<td>' . $this->e(strtoupper($row['environment'])) . '</td>'
            . '<td>' . $this->e($row['last_checked_at'] ? $row['last_checked_at'] : 'never') . '</td>'
            . '<td>' . $this->e($row['last_success_at'] ? $row['last_success_at'] : 'never') . '</td>'
            . '<td>' . $this->e($row['last_failure_at'] ? $row['last_failure_at'] : 'never')
            . ($row['last_failure_reason'] ? '<br><span class="text-muted">' . $this->e($row['last_failure_reason']) . '</span>' : '') . '</td><td>';

        $html .= '<a class="btn btn-xs btn-primary" href="' . $this->url(array('view' => 'configure', 'integration' => $definition->key(), 'environment' => $row['environment'])) . '">Configure</a> ';
        if ($row['configured']) {
            $html .= $this->inlineForm('test', $row['integration_id'], $data, 'Test', 'btn-default', $row['environment']);
            $html .= $this->toggleForm($row, $data);
        }
        return $html . '</td></tr>';
    }

    private function inlineForm($operation, $integrationId, array $data, $label, $class, $environment)
    {
        return '<form method="post" style="display:inline">'
            . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="' . $this->e($operation) . '">'
            . '<input type="hidden" name="integration_id" value="' . (int) $integrationId . '">'
            . $this->productionConfirm($environment, $operation . '-' . $integrationId)
            . ' <button class="btn btn-xs ' . $this->e($class) . '">' . $this->e($label) . '</button></form> ';
    }

    private function toggleForm(array $row, array $data)
    {
        return '<form method="post" style="display:inline">'
            . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="toggle">'
            . '<input type="hidden" name="integration_id" value="' . (int) $row['integration_id'] . '">'
            . '<input type="hidden" name="enabled" value="' . ($row['enabled'] ? '0' : '1') . '">'
            . (!$row['enabled'] ? $this->productionConfirm($row['environment'], 'enable-' . $row['integration_id']) : '')
            . ' <button class="btn btn-xs ' . ($row['enabled'] ? 'btn-warning' : 'btn-success') . '">' . ($row['enabled'] ? 'Disable' : 'Enable') . '</button></form>';
    }

    private function productionConfirm($environment, $id)
    {
        if (!Environment::isProduction($environment)) { return ''; }
        return '<label title="Production confirmation"><input type="checkbox" name="confirm_production" value="1" id="' . $this->e($id) . '" required> PROD</label>';
    }

    /* ------------------------------------------------------------ catalog */

    private function catalog(array $data)
    {
        $html = '<h3>Supported integrations</h3><p>Every entry below is backed by a real provider definition: documented credentials, a documented base URL policy and a real connection test. There are no placeholder integrations.</p>';
        foreach (ProviderRegistry::grouped() as $category => $definitions) {
            $html .= '<h4>' . $this->e(ProviderRegistry::categoryLabel($category)) . '</h4><table class="table"><thead><tr>'
                . '<th>Integration</th><th>Required credentials</th><th>Scopes / permissions</th><th>Connection test</th><th>Used by</th></tr></thead><tbody>';
            foreach ($definitions as $definition) {
                $credentials = array();
                foreach ($definition->fields() as $field) {
                    if ($field->isRequired()) { $credentials[] = $field->label() . ($field->isSecret() ? ' (secret)' : ''); }
                }
                $health = $definition->health();
                $html .= '<tr><td><strong>' . $this->e($definition->label()) . '</strong><br><span class="text-muted">' . $this->e($definition->summary()) . '</span>'
                    . ($definition->credentialsUrl() ? '<br><a href="' . $this->e($definition->credentialsUrl()) . '" rel="noopener noreferrer" target="_blank">Where to obtain credentials</a>' : '')
                    . '</td><td>' . $this->e($credentials ? implode(', ', $credentials) : 'none') . '</td>'
                    . '<td>' . $this->e($definition->scopes() ? implode(', ', $definition->scopes()) : 'not applicable') . '</td>'
                    . '<td><code>' . $this->e($health['method'] . ' ' . $health['path']) . '</code></td>'
                    . '<td>' . $this->e($definition->usedBy() ? implode(', ', $definition->usedBy()) : 'available for new work') . '</td></tr>';
            }
            $html .= '</tbody></table>';
        }
        return $html;
    }

    /* ---------------------------------------------------------- configure */

    private function configure(array $data)
    {
        /** @var ProviderDefinition $definition */
        $definition = $data['provider'];
        $config = $data['configuration'];
        $meta = $data['secret_metadata'];
        $environment = $data['environment'];
        $row = $data['row'];

        $html = '<h3>Configure: ' . $this->e($definition->label()) . '</h3>'
            . '<p>' . $this->e($definition->summary()) . '</p><dl class="dl-horizontal">'
            . '<dt>Vendor</dt><dd>' . $this->e($definition->vendor()) . '</dd>'
            . '<dt>Documentation</dt><dd>' . ($definition->documentation() ? '<a href="' . $this->e($definition->documentation()) . '" rel="noopener noreferrer" target="_blank">' . $this->e($definition->documentation()) . '</a>' : 'n/a') . '</dd>'
            . '<dt>Credentials</dt><dd>' . ($definition->credentialsUrl() ? '<a href="' . $this->e($definition->credentialsUrl()) . '" rel="noopener noreferrer" target="_blank">' . $this->e($definition->credentialsUrl()) . '</a>' : 'n/a') . '</dd>'
            . '<dt>Required scopes</dt><dd>' . $this->e($definition->scopes() ? implode(', ', $definition->scopes()) : 'not applicable') . '</dd>'
            . '<dt>Connection test</dt><dd><code>' . $this->e($definition->health()['method'] . ' ' . $definition->health()['path']) . '</code></dd>'
            . '<dt>Used by</dt><dd>' . $this->e($definition->usedBy() ? implode(', ', $definition->usedBy()) : 'available for new work') . '</dd>';
        if ($definition->notes()) { $html .= '<dt>Notes</dt><dd>' . $this->e($definition->notes()) . '</dd>'; }
        $html .= '</dl>';

        if ($row) {
            $html .= '<p><strong>Current status:</strong> <span class="label ' . $this->statusClass($row->status) . '">' . $this->e(ResultCode::label($row->status)) . '</span>'
                . ' · created ' . $this->e($row->created_at) . ' · last updated ' . $this->e($row->updated_at)
                . ' · last success ' . $this->e($row->last_success_at ? $row->last_success_at : 'never')
                . ' · last failure ' . $this->e($row->last_failure_at ? $row->last_failure_at : 'never') . '</p>';
        }

        $html .= '<form method="post" autocomplete="off">'
            . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="save">'
            . '<input type="hidden" name="provider_key" value="' . $this->e($definition->key()) . '">'
            . '<input type="hidden" name="environment" value="' . $this->e($environment) . '">'
            . '<div class="form-group"><label for="ch247-display-name">Integration name</label>'
            . '<input class="form-control" id="ch247-display-name" name="display_name" maxlength="128" value="' . $this->e($config ? $config['display_name'] : $definition->label()) . '"></div>';

        $html .= $this->baseUrlNotice($definition);
        foreach ($definition->fields() as $field) { $html .= $this->fieldControl($definition, $field, $config, $meta); }
        $html .= $this->operationalControls($definition, $config);

        $html .= '<div class="checkbox"><label><input type="checkbox" name="enabled" value="1"' . ($config && $config['enabled'] ? ' checked' : '') . '> Enabled &mdash; allow the platform to use this integration at runtime</label></div>';
        if (Environment::isProduction($environment)) {
            $html .= '<div class="alert alert-danger"><strong>PRODUCTION CONFIGURATION.</strong> These credentials will be used against live provider accounts.'
                . '<div class="checkbox"><label><input type="checkbox" name="confirm_production" value="1" required> I confirm I am saving PRODUCTION credentials for ' . $this->e($definition->label()) . '.</label></div></div>';
        }
        $html .= '<button class="btn btn-primary">Save integration</button> '
            . '<a class="btn btn-default" href="' . $this->url(array('view' => 'dashboard', 'environment' => $environment)) . '">Back to dashboard</a></form>';

        if ($row) {
            $html .= '<hr><h4>Connection test</h4><p>The test runs entirely on this server using the stored credentials and reports only a classification.</p><form method="post">'
                . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
                . '<input type="hidden" name="operation" value="test">'
                . '<input type="hidden" name="integration_id" value="' . (int) $row->id . '">'
                . (Environment::isProduction($environment) ? '<div class="checkbox"><label><input type="checkbox" name="confirm_production" value="1" required> I confirm I am testing the PRODUCTION configuration.</label></div>' : '')
                . '<button class="btn btn-default">Run connection test</button></form>';
            $html .= $this->rotationPanel($definition, $row, $meta, $data);
            $html .= '<hr><h4>Remove integration</h4><form method="post">'
                . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
                . '<input type="hidden" name="operation" value="delete">'
                . '<input type="hidden" name="integration_id" value="' . (int) $row->id . '">'
                . '<div class="checkbox"><label><input type="checkbox" name="confirm_delete" value="1" required> Delete this configuration and its encrypted credentials.</label></div>'
                . '<button class="btn btn-danger">Delete integration</button></form>';
        }
        return $html;
    }

    private function baseUrlNotice(ProviderDefinition $definition)
    {
        $spec = $definition->baseUrlSpec();
        switch ($definition->baseUrlMode()) {
            case ProviderDefinition::BASE_FIXED:
                return '<p class="text-muted">Endpoint: <code>' . $this->e($spec['url']) . '</code> (fixed by the provider and not administrator editable).</p>';
            case ProviderDefinition::BASE_REGION:
                return '<p class="text-muted">The endpoint is derived from the selected region and restricted to the documented provider hosts.</p>';
            case ProviderDefinition::BASE_ENVIRONMENT:
                $lines = array();
                foreach ($spec['map'] as $environment => $url) { $lines[] = $environment . ' → ' . $url; }
                return '<p class="text-muted">The endpoint follows the environment of this configuration: ' . $this->e(implode(' · ', $lines)) . '.</p>';
            default:
                $policy = $definition->hostPolicy();
                $notes = '';
                if (!empty($policy['allowed_hosts'])) { $notes .= ' Permitted hosts: ' . $this->e(implode(', ', (array) $policy['allowed_hosts'])) . '.'; }
                if (!empty($policy['allowed_ports'])) { $notes .= ' Permitted ports: ' . $this->e(implode(', ', array_map('intval', (array) $policy['allowed_ports']))) . '.'; }
                return '<p class="text-muted">Supply your own endpoint. Only HTTPS URLs without credentials, query strings or fragments are accepted. Private, loopback, link-local and reserved addresses are rejected.' . $notes . '</p>';
        }
    }

    private function fieldControl(ProviderDefinition $definition, FieldDefinition $field, $config, array $meta)
    {
        $key = $field->key();
        $id = 'ch247-field-' . preg_replace('/[^a-z0-9_-]/', '', $key);
        $label = '<label for="' . $this->e($id) . '">' . $this->e($field->label()) . ($field->isRequired() ? ' <span class="text-danger">*</span>' : '') . '</label>';
        $help = $field->help() ? '<span class="help-block">' . $this->e($field->help()) . '</span>' : '';

        if ($field->isSecret()) {
            $stored = isset($meta[$key]) ? $meta[$key] : null;
            $state = $stored
                ? '<span class="help-block">Stored credential: <code>' . $this->e($stored['masked']) . '</code>'
                    . ($stored['stale_key'] ? ' <strong class="text-danger">Encrypted with a previous master key — replace this credential.</strong>' : '')
                    . ' Leave the field blank to keep it unchanged.</span>'
                : '<span class="help-block">No credential stored yet.</span>';
            return '<div class="form-group">' . $label
                . '<input class="form-control" type="password" id="' . $this->e($id) . '" name="' . $this->e($key) . '" value="" autocomplete="new-password" spellcheck="false" maxlength="' . (int) $field->maxLength() . '" placeholder="Leave blank to keep the stored credential">'
                . $state . $help . '</div>';
        }

        $value = $this->currentValue($definition, $field, $config);
        if ($field->type() === FieldDefinition::TYPE_SELECT) {
            $control = '<select class="form-control" id="' . $this->e($id) . '" name="' . $this->e($key) . '">';
            if (!$field->isRequired()) { $control .= '<option value="">(not set)</option>'; }
            foreach ($field->options() as $option => $optionLabel) {
                $option = is_int($option) ? $optionLabel : $option;
                $control .= '<option value="' . $this->e($option) . '"' . ((string) $value === (string) $option ? ' selected' : '') . '>' . $this->e($optionLabel) . '</option>';
            }
            $control .= '</select>';
        } elseif ($field->type() === FieldDefinition::TYPE_NUMBER) {
            $control = '<input class="form-control" type="number" id="' . $this->e($id) . '" name="' . $this->e($key) . '" value="' . $this->e($value) . '" min="' . (int) $field->minValue() . '" max="' . (int) $field->maxLength() . '">';
        } elseif ($field->type() === FieldDefinition::TYPE_BOOLEAN) {
            return '<div class="checkbox"><label><input type="checkbox" name="' . $this->e($key) . '" value="1"' . ($value ? ' checked' : '') . '> ' . $this->e($field->label()) . '</label>' . $help . '</div>';
        } else {
            $type = $field->type() === FieldDefinition::TYPE_URL ? 'url' : 'text';
            $control = '<input class="form-control" type="' . $type . '" id="' . $this->e($id) . '" name="' . $this->e($key) . '" value="' . $this->e($value) . '" maxlength="' . (int) $field->maxLength() . '" spellcheck="false">';
        }
        return '<div class="form-group">' . $label . $control . $help . '</div>';
    }

    private function currentValue(ProviderDefinition $definition, FieldDefinition $field, $config)
    {
        $key = $field->key();
        if ($config === null) { return $field->defaultValue(); }
        if ($field->storage() === FieldDefinition::STORAGE_COLUMN) {
            return isset($config[$key]) ? $config[$key] : $field->defaultValue();
        }
        return isset($config['options'][$key]) ? $config['options'][$key] : $field->defaultValue();
    }

    private function operationalControls(ProviderDefinition $definition, $config)
    {
        $numbers = array(
            'timeout_seconds' => array('Response timeout (seconds)', 1, 120, $definition->defaultFor('timeout_seconds', 15)),
            'connect_timeout_seconds' => array('Connect timeout (seconds)', 1, 60, $definition->defaultFor('connect_timeout_seconds', 5)),
            'retry_attempts' => array('Retry attempts (idempotent requests only)', 0, 5, $definition->defaultFor('retry_attempts', 1)),
            'retry_backoff_ms' => array('Retry backoff (milliseconds)', 0, 10000, $definition->defaultFor('retry_backoff_ms', 250)),
        );
        $html = '<fieldset><legend>Timeouts and retry policy</legend><div class="row">';
        foreach ($numbers as $key => $spec) {
            $value = $config !== null && isset($config[$key]) ? $config[$key] : $spec[3];
            $id = 'ch247-' . str_replace('_', '-', $key);
            $html .= '<div class="col-sm-3"><div class="form-group"><label for="' . $this->e($id) . '">' . $this->e($spec[0]) . '</label>'
                . '<input class="form-control" type="number" id="' . $this->e($id) . '" name="' . $this->e($key) . '" value="' . $this->e($value) . '" min="' . (int) $spec[1] . '" max="' . (int) $spec[2] . '"></div></div>';
        }
        return $html . '</div><p class="help-block">Retries apply only to read-only requests and to provider throttling or temporary-unavailability responses; write operations are never replayed automatically.</p></fieldset>';
    }

    private function rotationPanel(ProviderDefinition $definition, $row, array $meta, array $data)
    {
        $secrets = $definition->secretFields();
        if (!$secrets) { return ''; }
        $html = '<hr><h4>Credential rotation</h4><p>Replace one credential without touching the rest of the configuration. The integration status is reset to NOT VERIFIED until the next successful test.</p>';
        foreach ($secrets as $field) {
            $stored = isset($meta[$field->key()]) ? $meta[$field->key()] : null;
            $html .= '<form method="post" class="form-inline" style="margin-bottom:6px" autocomplete="off">'
                . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
                . '<input type="hidden" name="operation" value="rotate">'
                . '<input type="hidden" name="integration_id" value="' . (int) $row->id . '">'
                . '<input type="hidden" name="field_key" value="' . $this->e($field->key()) . '">'
                . '<label>' . $this->e($field->label()) . ' <input class="form-control" type="password" name="field_value" value="" autocomplete="new-password" maxlength="' . (int) $field->maxLength() . '" placeholder="New value" required></label> '
                . '<span class="text-muted">' . $this->e($stored ? $stored['masked'] : 'not set') . '</span> '
                . (Environment::isProduction((string) $row->environment) ? '<label><input type="checkbox" name="confirm_production" value="1" required> Confirm PRODUCTION rotation</label> ' : '')
                . '<button class="btn btn-xs btn-warning">Replace</button></form>';
        }
        return $html;
    }

    /* ------------------------------------------------------------- events */

    private function events(array $data)
    {
        $events = $data['events'];
        $html = '<h3>Connection events</h3><p>Sanitized health-check and runtime-failure records. Provider payloads, credentials and stack traces are never stored here.</p>'
            . '<form method="get" class="form-inline">' . $this->getContext(array('view' => 'events', 'environment' => $data['environment']))
            . '<label>Integration <select class="form-control" name="provider_key"><option value="">All</option>';
        foreach (ProviderRegistry::all() as $key => $definition) {
            $selected = isset($data['event_filters']['provider_key']) && $data['event_filters']['provider_key'] === $key ? ' selected' : '';
            $html .= '<option value="' . $this->e($key) . '"' . $selected . '>' . $this->e($definition->label()) . '</option>';
        }
        $html .= '</select></label> <label>Result <select class="form-control" name="result_code"><option value="">All</option>';
        foreach ($data['result_codes'] as $code => $label) {
            $selected = isset($data['event_filters']['result_code']) && $data['event_filters']['result_code'] === $code ? ' selected' : '';
            $html .= '<option value="' . $this->e($code) . '"' . $selected . '>' . $this->e($label) . '</option>';
        }
        $html .= '</select></label> <label>Type <select class="form-control" name="event_type"><option value="">All</option>';
        foreach (array('health_check' => 'Health check', 'runtime_failure' => 'Runtime failure', 'configuration' => 'Configuration') as $type => $label) {
            $selected = isset($data['event_filters']['event_type']) && $data['event_filters']['event_type'] === $type ? ' selected' : '';
            $html .= '<option value="' . $this->e($type) . '"' . $selected . '>' . $this->e($label) . '</option>';
        }
        $html .= '</select></label> <label>Page <input class="form-control" type="number" min="1" name="event_page" value="' . (int) $events['page'] . '" style="width:80px"></label> '
            . '<button class="btn btn-default">Filter</button></form><br>';

        $html .= '<table class="table table-striped"><thead><tr><th>When</th><th>Integration</th><th>Environment</th><th>Type</th><th>Result</th><th>Latency</th><th>Detail</th><th>Reference</th></tr></thead><tbody>';
        foreach ($events['rows'] as $event) {
            $html .= '<tr><td>' . $this->e($event->created_at) . '</td><td>' . $this->e($event->provider_key) . '</td><td>' . $this->e(strtoupper((string) $event->environment)) . '</td>'
                . '<td>' . $this->e($event->event_type) . '</td>'
                . '<td><span class="label ' . $this->statusClass($event->result_code) . '">' . $this->e(ResultCode::label($event->result_code)) . '</span></td>'
                . '<td>' . ($event->latency_ms === null ? '-' : (int) $event->latency_ms . ' ms') . '</td>'
                . '<td>' . $this->e($event->detail) . '</td><td><code>' . $this->e($event->correlation_id) . '</code></td></tr>';
        }
        if (!$events['rows']) { $html .= '<tr><td colspan="8">No connection events recorded for this filter.</td></tr>'; }
        return $html . '</tbody></table><p class="text-muted">Page ' . (int) $events['page'] . ' of ' . (int) $events['pages'] . ' · ' . (int) $events['total'] . ' events.</p>';
    }

    /* ------------------------------------------------------------ helpers */

    private function statusClass($code)
    {
        switch ($code) {
            case ResultCode::CONNECTED:
                return 'label-success';
            case ResultCode::AUTHENTICATION_FAILED:
            case ResultCode::PERMISSION_DENIED:
            case ResultCode::INVALID_CONFIGURATION:
            case ResultCode::INVALID_ENDPOINT:
                return 'label-danger';
            case ResultCode::TIMEOUT:
            case ResultCode::PROVIDER_UNAVAILABLE:
                return 'label-warning';
            default:
                return 'label-default';
        }
    }

    private function url(array $parameters)
    {
        $url = $this->link;
        foreach ($parameters as $key => $value) {
            $url .= (strpos($url, '?') === false ? '?' : '&') . rawurlencode($key) . '=' . rawurlencode((string) $value);
        }
        return $this->e($url);
    }

    private function getContext(array $parameters)
    {
        $hidden = '';
        $query = array();
        $parts = explode('?', $this->link, 2);
        if (isset($parts[1])) { parse_str($parts[1], $query); }
        foreach (array_merge($query, $parameters) as $key => $value) {
            if (!is_scalar($value)) { continue; }
            $hidden .= '<input type="hidden" name="' . $this->e($key) . '" value="' . $this->e($value) . '">';
        }
        return $hidden;
    }

    private function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
