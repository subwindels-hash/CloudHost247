<?php
namespace CloudHost247\NetworkTools\Admin;

/**
 * Renders the Super Admin control centre (docs section 78).
 *
 * Plain, accessible server-rendered HTML using the admin theme's own classes
 * (alert, table, btn). Every dynamic value is escaped with htmlspecialchars, and
 * no credential is ever rendered: the providers table shows an endpoint and a
 * non-secret configuration blob only, because that is all this module stores.
 */
final class AdminView
{
    /** @var string */
    private $link;

    public function __construct($moduleLink)
    {
        $this->link = (string) $moduleLink;
    }

    public function render(array $data)
    {
        $html = '<div class="ch247-admin-tools">';
        $html .= $this->header($data);
        if ($data['notice'] !== '') {
            $html .= '<div class="alert alert-success">' . $this->e($data['notice']) . '</div>';
        }
        if ($data['error'] !== '') {
            $html .= '<div class="alert alert-danger">' . $this->e($data['error']) . '</div>';
        }
        $method = 'view' . ucfirst($data['view']);
        $html .= method_exists($this, $method) ? $this->$method($data) : $this->viewOverview($data);
        return $html . '</div>';
    }

    private function header(array $data)
    {
        $html = '<h2>CloudHost247 Network Tools</h2><p>Native DNS, IP, network, webmaster, security, domain and developer tools. ' . (int) $data['tool_count'] . ' tools registered.</p>';
        $html .= '<ul class="nav nav-pills" style="margin-bottom:15px">';
        foreach ($data['views'] as $id => $label) {
            $active = $data['view'] === $id ? ' class="active"' : '';
            $html .= '<li' . $active . '><a href="' . $this->e($this->link . '&ch247view=' . $id) . '">' . $this->e($label) . '</a></li>';
        }
        $html .= '</ul>';
        return $html;
    }

    private function formOpen($action)
    {
        return '<form method="post" action="' . $this->e($this->link) . '" style="margin:0">'
            . '<input type="hidden" name="token" value="' . $this->e(function_exists('generate_token') ? generate_token('plain') : '') . '">'
            . '<input type="hidden" name="ch247_action" value="' . $this->e($action) . '">';
    }

    private function viewOverview(array $data)
    {
        $html = '<div class="row"><div class="col-md-6"><h3>Platform state</h3><table class="table table-striped">';
        $rows = array(
            'Platform enabled' => $data['settings']['enabled'] === '1' ? 'Yes' : 'No — every tool reports the platform as disabled',
            'Public access (no sign-in)' => $data['settings']['public_access'] === '1' ? 'Allowed for public tools' : 'Sign-in required everywhere',
            'Tools registered' => (string) $data['tool_count'],
            'Enabled resolvers' => $this->countEnabled($data['resolvers']) . ' of ' . count($data['resolvers']),
            'Enabled providers' => $this->countEnabled($data['providers']) . ' of ' . count($data['providers']),
            'Cached results' => (int) $data['cache_size'] . ' entry(ies)',
            'Executions (30 days)' => isset($data['metrics']['total']) ? (int) $data['metrics']['total'] : 0,
        );
        foreach ($rows as $label => $value) {
            $html .= '<tr><th scope="row">' . $this->e($label) . '</th><td>' . $this->e($value) . '</td></tr>';
        }
        $html .= '</table></div><div class="col-md-6"><h3>Quick actions</h3>';
        $html .= $this->formOpen('health_run') . '<button class="btn btn-default" type="submit">Run resolver &amp; provider health check now</button></form> ';
        $html .= $this->formOpen('cache_flush') . '<button class="btn btn-default" type="submit">Empty the result cache</button></form> ';
        $html .= $this->formOpen('history_prune') . '<button class="btn btn-default" type="submit">Prune execution history</button></form>';
        $html .= '<h3 style="margin-top:20px">Resolver health</h3>' . $this->healthTable($data['health']['resolver'] ?? array());
        $html .= '<h3>Provider health</h3>' . $this->healthTable($data['health']['provider'] ?? array());
        $html .= '</div></div>';
        return $html;
    }

    private function viewTools(array $data)
    {
        $html = '<h3>Tools</h3>'
            . '<p>Status controls the state shown on the client side. Visibility decides who may open a tool: <em>public</em> follows the platform public-access setting, <em>customer</em> requires a signed-in account, <em>admin</em> is limited to administrators. Rate limits left empty use the tier defaults shown below.</p>'
            . '<table class="table table-striped"><thead><tr><th>Tool</th><th>Category</th><th>State</th><th>Visibility</th><th>Rate limits (count / window seconds)</th><th>Timeout</th><th>Cache</th><th></th></tr></thead><tbody>';
        foreach ($data['tools'] as $tool) {
            $html .= '<tr><td><strong>' . $this->e($tool['name']) . '</strong><br><small>' . $this->e($tool['slug']) . '<br>' . $this->e($tool['effective_detail'] !== '' ? $tool['effective_detail'] : '') . '</small></td>'
                . '<td>' . $this->e($tool['category']) . '</td>'
                . '<td>' . $this->e($tool['effective_state']) . '</td>'
                . '<td colspan="5">'
                . $this->formOpen('tool_save')
                . '<input type="hidden" name="slug" value="' . $this->e($tool['slug']) . '">'
                . '<select name="status">' . $this->options(array('ACTIVE', 'DISABLED', 'MAINTENANCE', 'CONFIGURATION_REQUIRED', 'SERVICE_UNAVAILABLE'), $tool['status']) . '</select> '
                . '<select name="visibility">' . $this->options(array('public', 'customer', 'admin'), $tool['visibility']) . '</select> '
                . '<select name="rate_tier">' . $this->options(array('local', 'standard', 'high_risk'), $tool['rate_tier']) . '</select><br>'
                . $this->limitInputs($tool)
                . 'Timeout <input type="number" name="timeout_seconds" min="1" max="60" value="' . (int) $tool['timeout_seconds'] . '" style="width:70px"> '
                . 'Cache <input type="number" name="cache_seconds" min="0" max="86400" value="' . (int) $tool['cache_seconds'] . '" style="width:80px"> '
                . 'Providers <input type="text" name="provider_keys" value="' . $this->e($tool['providers']) . '" style="width:220px" placeholder="comma separated keys"> '
                . '<button class="btn btn-primary btn-sm" type="submit">Save</button>'
                . '</form></td></tr>';
        }
        return $html . '</tbody></table>'
            . '<h4>Tier defaults</h4><table class="table table-condensed"><thead><tr><th>Tier</th><th>Per IP</th><th>Per account</th><th>Per tool + IP</th><th>Per tool (all)</th></tr></thead><tbody>'
            . $this->tierRows($data['rate_limits']) . '</tbody></table>';
    }

    private function limitInputs(array $tool)
    {
        $limits = array();
        if ($tool['rate_limits'] !== '') {
            $decoded = json_decode((string) $tool['rate_limits'], true);
            if (is_array($decoded)) {
                $limits = $decoded;
            }
        }
        $html = '';
        foreach (array('ip', 'client', 'tool_ip', 'tool_global') as $dimension) {
            $count = isset($limits[$dimension][0]) ? (int) $limits[$dimension][0] : '';
            $window = isset($limits[$dimension][1]) ? (int) $limits[$dimension][1] : '';
            $html .= $this->e($dimension) . ' <input type="number" name="limit_' . $this->e($dimension) . '_count" value="' . $this->e((string) $count) . '" placeholder="count" style="width:70px">/';
            $html .= '<input type="number" name="limit_' . $this->e($dimension) . '_window" value="' . $this->e((string) $window) . '" placeholder="seconds" style="width:80px"> ';
        }
        return $html . '<br>';
    }

    private function tierRows(array $limits)
    {
        $html = '';
        foreach ($limits as $tier => $dimensions) {
            $html .= '<tr><th scope="row">' . $this->e($tier) . '</th>';
            foreach (array('ip', 'client', 'tool_ip', 'tool_global') as $dimension) {
                $rule = isset($dimensions[$dimension]) ? $dimensions[$dimension] : array(0, 0);
                $html .= '<td>' . (int) $rule[0] . ' / ' . (int) $rule[1] . 's</td>';
            }
            $html .= '</tr>';
        }
        return $html;
    }

    private function viewResolvers(array $data)
    {
        $html = '<h3>Resolver registry</h3>'
            . '<p>Each row declares the protocols it is actually known to serve. DoT and DoH rows need an endpoint; a UDP row is queried directly. Shipped rows are real public resolvers, and health is measured by a live query, not assumed.</p>';
        $html .= $this->formOpen('resolver_seed') . '<button class="btn btn-default" type="submit">Add the shipped resolver set</button></form>';
        $html .= '<table class="table table-striped"><thead><tr><th>Name</th><th>Provider</th><th>Address</th><th>Protocol</th><th>Location</th><th>Health</th><th>Enabled</th><th></th></tr></thead><tbody>';
        foreach ($data['resolvers'] as $row) {
            $html .= '<tr><td>' . $this->e((string) $row->name) . '</td><td>' . $this->e((string) $row->provider) . '</td><td>' . $this->e((string) $row->ip_address) . '</td><td>' . $this->e(strtoupper((string) $row->protocol)) . ' / ' . $this->e((string) $row->version) . '</td>'
                . '<td>' . $this->e(trim((string) $row->city . ' ' . (string) $row->region . ' ' . (string) $row->country_code)) . '</td>'
                . '<td>' . $this->e((string) $row->health_status) . (isset($row->last_latency_ms) ? ' (' . (int) $row->last_latency_ms . ' ms)' : '') . '</td>'
                . '<td>' . ((int) $row->enabled === 1 ? 'Yes' : 'No') . '</td><td>'
                . $this->formOpen('resolver_toggle') . '<input type="hidden" name="resolver_id" value="' . (int) $row->id . '"><button class="btn btn-xs btn-default" type="submit">' . ((int) $row->enabled === 1 ? 'Disable' : 'Enable') . '</button></form> '
                . $this->formOpen('resolver_delete') . '<input type="hidden" name="resolver_id" value="' . (int) $row->id . '"><button class="btn btn-xs btn-danger" type="submit">Remove</button></form>'
                . '</td></tr>';
        }
        $html .= '</tbody></table>';
        $html .= '<h4>Add or update a resolver</h4>' . $this->formOpen('resolver_save')
            . '<input type="hidden" name="resolver_id" value="0">'
            . '<table class="table table-condensed"><tbody>'
            . '<tr><th>Name</th><td><input type="text" name="name" required></td><th>Provider</th><td><input type="text" name="provider"></td></tr>'
            . '<tr><th>Address</th><td><input type="text" name="ip_address" required placeholder="1.1.1.1 or 2606:4700::1111"></td><th>Protocol</th><td><select name="protocol">' . $this->options(array('udp', 'tcp', 'dot', 'doh'), 'udp') . '</select> <select name="version">' . $this->options(array('v4', 'v6'), 'v4') . '</select></td></tr>'
            . '<tr><th>Endpoint (DoT host / DoH URL)</th><td><input type="text" name="endpoint" style="width:320px"></td><th>Priority</th><td><input type="number" name="priority" value="100" min="1" max="9999"></td></tr>'
            . '<tr><th>Country / region / city</th><td><input type="text" name="country_code" size="4"> <input type="text" name="region" size="10"> <input type="text" name="city" size="10"></td><th>Latitude / longitude</th><td><input type="text" name="latitude" size="8"> <input type="text" name="longitude" size="8"></td></tr>'
            . '<tr><th>Enabled</th><td><input type="checkbox" name="enabled" value="1"></td><th></th><td><button class="btn btn-primary" type="submit">Save resolver</button></td></tr>'
            . '</tbody></table></form>';
        return $html;
    }

    private function viewProviders(array $data)
    {
        $html = '<h3>Tool providers</h3>'
            . '<p>This registry holds endpoints and non-secret metadata only. Credentials belong in <em>Admin → API &amp; Integrations</em>, which encrypts them; a provider row here selects and orders already-configured integrations. DNS blocklist rows carry the zone and its documented reply meaning.</p>';
        $html .= '<table class="table table-striped"><thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Endpoint / zone</th><th>Health</th><th>Enabled</th><th></th></tr></thead><tbody>';
        foreach ($data['providers'] as $row) {
            $html .= '<tr><td>' . $this->e((string) $row->provider_key) . '</td><td>' . $this->e((string) $row->label) . '</td><td>' . $this->e((string) $row->type) . '</td><td>' . $this->e((string) $row->endpoint) . '</td>'
                . '<td>' . $this->e((string) $row->health_status) . '</td><td>' . ((int) $row->enabled === 1 ? 'Yes' : 'No') . '</td><td>'
                . $this->formOpen('provider_toggle') . '<input type="hidden" name="provider_id" value="' . (int) $row->id . '"><button class="btn btn-xs btn-default" type="submit">' . ((int) $row->enabled === 1 ? 'Disable' : 'Enable') . '</button></form> '
                . $this->formOpen('provider_delete') . '<input type="hidden" name="provider_id" value="' . (int) $row->id . '"><button class="btn btn-xs btn-danger" type="submit">Remove</button></form>'
                . '</td></tr>';
        }
        $html .= '</tbody></table>';
        $html .= '<h4>Add or update a provider</h4>' . $this->formOpen('provider_save')
            . '<input type="hidden" name="provider_id" value="0">'
            . '<table class="table table-condensed"><tbody>'
            . '<tr><th>Provider key</th><td><input type="text" name="provider_key" required placeholder="tool.bin_lookup or dnsbl.example"></td><th>Label</th><td><input type="text" name="label" required></td></tr>'
            . '<tr><th>Type</th><td><select name="type">' . $this->options(array('integration', 'dnsbl', 'http'), 'http') . '</select></td><th>Priority</th><td><input type="number" name="priority" value="100" min="1" max="9999"></td></tr>'
            . '<tr><th>Endpoint / zone</th><td><input type="text" name="endpoint" style="width:320px"></td><th>Timeout</th><td><input type="number" name="timeout_seconds" value="5" min="1" max="30"></td></tr>'
            . '<tr><th>Non-secret configuration (JSON)</th><td colspan="3"><textarea name="configuration" rows="3" style="width:100%" placeholder="{&quot;parameter&quot;:&quot;bin&quot;,&quot;map&quot;:{&quot;issuer&quot;:&quot;bank.name&quot;}}"></textarea><br><small>Never put an API key, token or password here: the module refuses to store one.</small></td></tr>'
            . '<tr><th>Rate limit / minute</th><td><input type="number" name="rate_limit_per_minute" value="30" min="0" max="10000"></td><th>Enabled</th><td><input type="checkbox" name="enabled" value="1"> <button class="btn btn-primary" type="submit">Save provider</button></td></tr>'
            . '</tbody></table></form>';
        return $html;
    }

    private function viewHealth(array $data)
    {
        return '<h3>Health</h3><p>Latest recorded status per subject, with the 24-hour error rate.</p>'
            . '<h4>Resolvers</h4>' . $this->healthTable($data['health']['resolver'] ?? array())
            . '<h4>Providers</h4>' . $this->healthTable($data['health']['provider'] ?? array());
    }

    private function healthTable(array $summary)
    {
        if (!$summary) {
            return '<p>No health checks recorded yet. Run one from the Overview tab, or wait for the cron.</p>';
        }
        $html = '<table class="table table-condensed"><thead><tr><th>Subject</th><th>Status</th><th>Latency</th><th>24h error rate</th><th>Last checked</th></tr></thead><tbody>';
        foreach ($summary as $row) {
            $html .= '<tr><td>' . $this->e((string) $row['subject_key']) . '</td><td>' . $this->e((string) $row['last_status']) . '</td><td>'
                . (isset($row['last_latency_ms']) && $row['last_latency_ms'] !== null ? (int) $row['last_latency_ms'] . ' ms' : '—') . '</td><td>'
                . $this->e((string) $row['error_rate']) . '% (' . (int) $row['failures'] . '/' . (int) $row['checks'] . ')</td><td>'
                . $this->e((string) ($row['last_checked_at'] ?? '')) . '</td></tr>';
        }
        return $html . '</tbody></table>';
    }

    private function viewAnalytics(array $data)
    {
        $metrics = $data['metrics'];
        $html = '<h3>Analytics (30 days)</h3><p>Metadata only: tool, category, actor type, result code, duration and cache state. Target values, credentials and submitted content are never recorded.</p>';
        $html .= '<table class="table table-condensed"><tbody>';
        $html .= '<tr><th>Executions</th><td>' . (int) (isset($metrics['total']) ? $metrics['total'] : 0) . '</td><th>Failures</th><td>' . (int) (isset($metrics['failures']) ? $metrics['failures'] : 0) . '</td></tr>';
        $html .= '<tr><th>Cache hits</th><td>' . (int) (isset($metrics['cached']) ? $metrics['cached'] : 0) . '</td><th>Average duration</th><td>' . (int) (isset($metrics['average_duration_ms']) ? $metrics['average_duration_ms'] : 0) . ' ms</td></tr>';
        $html .= '</tbody></table>';
        if (!empty($metrics['by_tool'])) {
            $html .= '<h4>By tool</h4><table class="table table-striped"><thead><tr><th>Tool</th><th>Runs</th><th>Failures</th><th>Avg ms</th></tr></thead><tbody>';
            foreach ($metrics['by_tool'] as $row) {
                $html .= '<tr><td>' . $this->e((string) $row['tool_slug']) . '</td><td>' . (int) $row['total'] . '</td><td>' . (int) $row['failures'] . '</td><td>' . (int) $row['average_duration_ms'] . '</td></tr>';
            }
            $html .= '</tbody></table>';
        }
        $html .= '<h4>Recent executions</h4><table class="table table-condensed"><thead><tr><th>When</th><th>Tool</th><th>Actor</th><th>Result</th><th>Duration</th><th>Cached</th></tr></thead><tbody>';
        foreach ($data['recent_executions'] as $row) {
            $html .= '<tr><td>' . $this->e((string) $row->created_at) . '</td><td>' . $this->e((string) $row->tool_slug) . '</td><td>' . $this->e((string) $row->actor_type) . '</td><td>' . $this->e((string) $row->result_code) . '</td><td>' . (int) $row->duration_ms . ' ms</td><td>' . (!empty($row->cached) ? 'Yes' : 'No') . '</td></tr>';
        }
        return $html . '</tbody></table>';
    }

    private function viewAbuse(array $data)
    {
        $html = '<h3>Abuse controls</h3><p>High-risk tools (ping, traceroute, port check, crawl, SMTP test, speed test) are limited harder and a client address that keeps hitting limits is locked out for 15 minutes. Threshold: <strong>' . (int) $data['settings']['abuse_block_threshold'] . '</strong> recent events.</p>';
        $html .= '<table class="table table-condensed"><thead><tr><th>When</th><th>Event</th><th>Address</th><th>Client</th><th>Tool</th><th>Detail</th></tr></thead><tbody>';
        foreach ($data['abuse'] as $row) {
            $html .= '<tr><td>' . $this->e((string) $row->created_at) . '</td><td>' . $this->e((string) $row->event_type) . '</td><td>' . $this->e((string) $row->ip_address) . '</td><td>' . (int) $row->client_id . '</td><td>' . $this->e((string) $row->tool_slug) . '</td><td>' . $this->e((string) $row->detail) . '</td></tr>';
        }
        return $html . '</tbody></table>';
    }

    private function viewSettings(array $data)
    {
        $html = '<h3>Settings</h3><p>These defaults are stored in the module\'s own settings table. Feature flags disable a whole behaviour without touching code.</p>';
        $html .= $this->formOpen('settings_save') . '<table class="table table-striped"><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>';
        foreach ($data['setting_keys'] as $key => $default) {
            $value = isset($data['settings'][$key]) ? $data['settings'][$key] : $default;
            $label = ucwords(str_replace('_', ' ', $key));
            if (preg_match('/^(enabled|public_access|trust_proxy_headers|history_enabled|monitoring_enabled|ai_explanations_enabled)$/', $key)) {
                $control = '<select name="setting_' . $this->e($key) . '">' . $this->options(array('1', '0'), (string) $value, array('1' => 'Enabled', '0' => 'Disabled')) . '</select>';
            } else {
                $control = '<input type="text" name="setting_' . $this->e($key) . '" value="' . $this->e((string) $value) . '" style="width:320px">';
            }
            $html .= '<tr><th scope="row">' . $this->e($label) . '<br><small>' . $this->e($key) . '</small></th><td>' . $control . '<br><small>Default: ' . $this->e((string) $default) . '</small></td></tr>';
        }
        $html .= '</tbody></table><button class="btn btn-primary" type="submit">Save settings</button></form>';
        $html .= '<h4>Where credentials live</h4><p>API keys for geo-IP, WHOIS, AI, OCR, registrar and monitoring providers are configured once under <a href="' . $this->e('configaddonmods.php') . '">Settings → API &amp; Integrations</a>, where they are encrypted at rest. This module never asks for a credential in its own settings.</p>';
        return $html;
    }

    private function options(array $values, $selected, array $labels = array())
    {
        $html = '';
        foreach ($values as $value) {
            $label = isset($labels[$value]) ? $labels[$value] : $value;
            $html .= '<option value="' . $this->e($value) . '"' . ((string) $selected === (string) $value ? ' selected' : '') . '>' . $this->e($label) . '</option>';
        }
        return $html;
    }

    private function countEnabled(array $rows)
    {
        $count = 0;
        foreach ($rows as $row) {
            if ((int) $row->enabled === 1) {
                $count++;
            }
        }
        return $count;
    }

    private function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
